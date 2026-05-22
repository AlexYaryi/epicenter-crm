"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Locale } from "@/lib/i18n";

type Preview = {
  id: string;
  name: string;
  src: string;
  status: "ready" | "uploading" | "done" | "error";
  progress: number;
  error?: string;
};

async function loadBitmap(file: File) {
  if ("createImageBitmap" in window) {
    return createImageBitmap(file);
  }
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const src = URL.createObjectURL(file);
    const element = new Image();
    element.onload = () => {
      URL.revokeObjectURL(src);
      resolve(element);
    };
    element.onerror = () => {
      URL.revokeObjectURL(src);
      reject(new Error("Unsupported image format"));
    };
    element.src = src;
  });
  return image;
}

async function compressImage(file: File) {
  const bitmap = await loadBitmap(file);
  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return file;
  context.drawImage(bitmap, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", 0.82);
  });
  if ("close" in bitmap) bitmap.close();
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" });
}

export function VehiclePhotoUploader({ vehicleId, locale }: { vehicleId: string; locale: Locale }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [uploaded, setUploaded] = useState(0);
  const [uploadTotal, setUploadTotal] = useState(0);
  const [message, setMessage] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const total = uploadTotal || files.length;
  const progress = useMemo(() => (total ? Math.round((uploaded / total) * 100) : 0), [total, uploaded]);

  function previewFromFile(file: File): Preview {
    return {
      id: crypto.randomUUID(),
      name: file.name,
      src: URL.createObjectURL(file),
      status: "ready",
      progress: 0
    };
  }

  function onSelect(selected: FileList | null) {
    const next = Array.from(selected ?? []).filter((file) => file.type.startsWith("image/"));
    setFiles(next);
    setUploaded(0);
    setUploadTotal(next.length);
    setMessage(next.length
      ? locale === "en" ? `${next.length} photos selected. Press upload.` : `Выбрано ${next.length} фото. Нажмите загрузить.`
      : "");
    setPreviews(next.map(previewFromFile));
  }

  function uploadPhoto(file: File, index: number) {
    return new Promise<string>((resolve, reject) => {
      const body = new FormData();
      body.append("file", file);
      const request = new XMLHttpRequest();
      request.timeout = 120000;
      request.open("POST", `/api/vehicles/${vehicleId}/photos`);
      request.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        const percent = Math.max(1, Math.min(99, Math.round((event.loaded / event.total) * 100)));
        setPreviews((items) =>
          items.map((item, itemIndex) => (itemIndex === index ? { ...item, status: "uploading", progress: percent } : item))
        );
      };
      request.onload = () => {
        try {
          const payload = JSON.parse(request.responseText || "{}") as { url?: string; error?: string };
          if (request.status >= 200 && request.status < 300 && payload.url) {
            resolve(payload.url);
            return;
          }
          reject(new Error(payload.error || `Upload failed with status ${request.status}`));
        } catch {
          reject(new Error(`Upload failed with status ${request.status}`));
        }
      };
      request.onerror = () => reject(new Error("Network upload error"));
      request.ontimeout = () => reject(new Error("Upload timeout. Try fewer photos or a smaller file."));
      request.send(body);
    });
  }

  async function upload() {
    const selectedFiles = files.length ? files : Array.from(inputRef.current?.files ?? []).filter((file) => file.type.startsWith("image/"));
    if (!selectedFiles.length) {
      setMessage(locale === "en" ? "Choose photos first." : "Сначала выберите фотографии.");
      return;
    }
    if (!files.length) {
      setFiles(selectedFiles);
      setPreviews(selectedFiles.map(previewFromFile));
    }
    setUploaded(0);
    setUploadTotal(selectedFiles.length);
    setIsUploading(true);
    setMessage(locale === "en" ? "Preparing and optimizing photos..." : "Подготавливаю и оптимизирую фотографии...");
    let done = 0;
    for (let index = 0; index < selectedFiles.length; index += 1) {
      setPreviews((items) => items.map((item, itemIndex) => (itemIndex === index ? { ...item, status: "uploading", progress: 1 } : item)));
      try {
        let optimized = selectedFiles[index];
        try {
          optimized = await compressImage(selectedFiles[index]);
        } catch (error) {
          console.warn("Image compression failed, uploading original.", error);
          if (!selectedFiles[index].type.match(/^image\/(jpeg|jpg|png|webp)$/i)) {
            throw new Error(locale === "en" ? "Unsupported image format. Use JPG, PNG or WebP." : "Неподдерживаемый формат фото. Используйте JPG, PNG или WebP.");
          }
        }
        const url = await uploadPhoto(optimized, index);
        done += 1;
        setUploaded(done);
        setMessage(locale === "en" ? `Uploaded ${done} of ${selectedFiles.length}` : `Загружено ${done} из ${selectedFiles.length}`);
        setPreviews((items) =>
          items.map((item, itemIndex) => (itemIndex === index ? { ...item, src: url, status: "done", progress: 100 } : item))
        );
      } catch (error) {
        console.error(error);
        const errorMessage = error instanceof Error ? error.message : "Upload error";
        setPreviews((items) => items.map((item, itemIndex) => (itemIndex === index ? { ...item, status: "error", error: errorMessage } : item)));
        setMessage(locale === "en" ? `Some photos were not uploaded: ${errorMessage}` : `Часть фото не загрузилась: ${errorMessage}`);
      }
    }
    setIsUploading(false);
    setMessage(done === selectedFiles.length
      ? locale === "en" ? "All photos uploaded and saved. Refreshing card..." : "Все фотографии загружены и сохранены. Обновляю карточку..."
      : locale === "en" ? `Uploaded ${done} of ${selectedFiles.length}. Check failed photos.` : `Загружено ${done} из ${selectedFiles.length}. Проверьте фото с ошибкой.`
    );
    startTransition(() => router.refresh());
  }

  return (
    <div className="smart-upload">
      <div className="upload-inline">
        <input ref={inputRef} name="files" type="file" accept="image/*" multiple onInput={(event) => onSelect(event.currentTarget.files)} onChange={(event) => onSelect(event.target.files)} />
        <button className="primary" type="button" onClick={upload} disabled={isUploading}>
          {locale === "en" ? "Upload selected photos" : "Загрузить выбранные фотографии"}
        </button>
      </div>
      {files.length ? <div className="muted">{locale === "en" ? "Selected photos" : "Выбрано фотографий"}: {files.length}</div> : null}
      {total ? (
        <>
          <div className="upload-progress-line">
            <span>
              {locale === "en" ? "Uploaded" : "Загружено"}: {uploaded} / {total}
            </span>
            <b>{progress}%</b>
          </div>
          <div className="upload-progress-track"><span style={{ width: `${progress}%` }} /></div>
        </>
      ) : null}
      {message ? <div className="save-notice ok">{message}{isPending ? "..." : ""}</div> : null}
      {previews.length ? (
        <div className="vehicle-photo-grid upload-preview-grid">
          {previews.map((preview) => (
            <div className={`vehicle-photo-card upload-preview ${preview.status}`} key={preview.id}>
              <img src={preview.src} alt={preview.name} />
              <span>{preview.status === "done" ? (locale === "en" ? "Uploaded" : "Загружено") : preview.status === "error" ? `${locale === "en" ? "Error" : "Ошибка"}: ${preview.error ?? ""}` : preview.status === "uploading" ? `${locale === "en" ? "Uploading" : "Загрузка"} ${preview.progress}%` : preview.name}</span>
              {preview.status === "uploading" ? <div className="upload-card-progress"><span style={{ width: `${preview.progress}%` }} /></div> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
