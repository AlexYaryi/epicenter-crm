"use client";

import { useState, useTransition } from "react";
import { deleteVehiclePhotoAction, updateVehiclePhotosOrderAction } from "@/lib/actions";

type VehiclePhotoSorterProps = {
  vehicleId: string;
  photos: string[];
  canManageFleet: boolean;
  locale: "en" | "ru";
};

export function VehiclePhotoSorter({ vehicleId, photos: initialPhotos, canManageFleet, locale }: VehiclePhotoSorterProps) {
  const [photos, setPhotos] = useState<string[]>(initialPhotos);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // HTML5 Drag and Drop Handlers
  const handleDragStart = (index: number) => {
    if (!canManageFleet) return;
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    if (!canManageFleet || draggedIndex === null || draggedIndex === index) return;
    e.preventDefault(); // Required to allow drop

    // Permute photos locally for a live interactive feel
    const updatedPhotos = [...photos];
    const draggedItem = updatedPhotos[draggedIndex];
    
    // Remove the item from its original position
    updatedPhotos.splice(draggedIndex, 1);
    // Insert it at the new hover position
    updatedPhotos.splice(index, 0, draggedItem);
    
    setDraggedIndex(index);
    setPhotos(updatedPhotos);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    
    // Save new order to Supabase
    startTransition(async () => {
      setStatusMessage(locale === "en" ? "Saving photo order..." : "Сохранение порядка фото...");
      const result = await updateVehiclePhotosOrderAction(vehicleId, photos);
      if (result.ok) {
        setStatusMessage(locale === "en" ? "Saved!" : "Сохранено!");
        setTimeout(() => setStatusMessage(null), 2000);
      } else {
        setStatusMessage(locale === "en" ? `Error: ${result.message}` : `Ошибка: ${result.message}`);
        setTimeout(() => setStatusMessage(null), 4000);
      }
    });
  };

  return (
    <div className="vehicle-photo-sorter-wrap">
      {statusMessage && (
        <div className={`pricing-badge-row ${isPending ? "warn" : "ok"}`} style={{
          marginBottom: "1rem",
          display: "inline-block",
          padding: "0.5rem 1rem",
          borderRadius: "6px",
          fontWeight: "bold",
          fontSize: "0.9rem",
          boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
          transition: "all 0.3s ease"
        }}>
          {statusMessage}
        </div>
      )}

      <div className="vehicle-photo-grid">
        {photos.map((photo, index) => (
          <div
            className={`vehicle-photo-card ${draggedIndex === index ? "dragging" : ""}`}
            key={photo}
            draggable={canManageFleet}
            onDragStart={() => handleDragStart(index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragEnd={handleDragEnd}
            style={{
              cursor: canManageFleet ? "grab" : "default",
              opacity: draggedIndex === index ? 0.4 : 1,
              transform: draggedIndex === index ? "scale(0.98)" : "none",
              transition: "transform 0.2s ease, opacity 0.2s ease",
              border: draggedIndex === index ? "2px dashed #ffc107" : "1px solid rgba(0, 0, 0, 0.1)"
            }}
          >
            <img 
              src={photo} 
              alt={`Photo ${index + 1}`} 
              draggable={false} // Prevents image default drag behavior interfering with card drag
              style={{ userSelect: "none" }}
            />
            {canManageFleet ? (
              <form action={deleteVehiclePhotoAction}>
                <input type="hidden" name="vehicle_id" value={vehicleId} />
                <input type="hidden" name="photo_url" value={photo} />
                <button 
                  type="submit" 
                  className="button danger-button"
                  style={{ width: "100%", marginTop: "8px" }}
                >
                  {locale === "en" ? "Delete" : "Удалить"}
                </button>
              </form>
            ) : null}
          </div>
        ))}
        {photos.length === 0 ? (
          <p className="muted">{locale === "en" ? "No photos yet." : "Фото пока не загружены."}</p>
        ) : null}
      </div>
    </div>
  );
}
