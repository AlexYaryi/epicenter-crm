import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentUserContext } from "@/lib/repository";
import { createServiceSupabaseClient, hasSupabaseEnv } from "@/lib/supabase";

export const revalidate = 0;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteParams = {
  params: Promise<{ id: string }>;
};

type StoredDocument = {
  url: string;
  name: string;
  type: string;
};

const allowedFields = new Set(["passport", "driver_license", "idp"]);
const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf"
]);
const customerDocumentsBucket = "customer-documents";
const maxDocumentSize = 15 * 1024 * 1024;

function dbFieldFor(field: string) {
  if (field === "passport") return "passport_photo_url";
  if (field === "driver_license") return "driver_license_photo_url";
  if (field === "idp") return "idp_photo_url";
  return null;
}

function parseStoredDocuments(value: unknown): StoredDocument[] {
  const raw = String(value ?? "");
  if (!raw) return [];
  try {
    if (raw.startsWith("[") && raw.endsWith("]")) {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed
            .map((item) => ({
              url: String(item?.url ?? ""),
              name: String(item?.name ?? "Document"),
              type: String(item?.type ?? "image/jpeg")
            }))
            .filter((item) => item.url)
        : [];
    }
  } catch {
    return [{ url: raw, name: "Document", type: "image/jpeg" }];
  }
  return [{ url: raw, name: "Document", type: "image/jpeg" }];
}

async function ensureCustomerDocumentsBucket(supabase: ReturnType<typeof createServiceSupabaseClient>) {
  const { error: updateError } = await supabase.storage.updateBucket(customerDocumentsBucket, {
    public: false,
    fileSizeLimit: "15MB",
    allowedMimeTypes: Array.from(allowedMimeTypes)
  });
  if (!updateError) return null;
  if (!/bucket|not found/i.test(updateError.message)) return updateError;

  const { error: createError } = await supabase.storage.createBucket(customerDocumentsBucket, {
    public: false,
    fileSizeLimit: "15MB",
    allowedMimeTypes: Array.from(allowedMimeTypes)
  });
  if (createError && !/already exists/i.test(createError.message)) return createError;
  return null;
}

export async function POST(request: Request, { params }: RouteParams) {
  const { id: customerId } = await params;
  const user = await getCurrentUserContext();
  if (user.supabaseConfigured && !user.isAuthenticated) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (!["owner", "manager", "operator"].includes(user.role)) {
    return NextResponse.json({ error: `Forbidden for role: ${user.role}` }, { status: 403 });
  }
  if (!hasSupabaseEnv() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "Invalid multipart form data." }, { status: 400 });
  }

  const field = String(formData.get("field") ?? "");
  const dbField = dbFieldFor(field);
  if (!allowedFields.has(field) || !dbField) {
    return NextResponse.json({ error: "Некорректный тип документа." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Выберите файл для загрузки." }, { status: 400 });
  }
  if (file.size > maxDocumentSize) {
    return NextResponse.json({ error: "Файл слишком большой. Максимум 15 MB." }, { status: 413 });
  }
  if (file.type && !allowedMimeTypes.has(file.type)) {
    return NextResponse.json({ error: `Неподдерживаемый тип файла: ${file.type}` }, { status: 415 });
  }

  const supabase = createServiceSupabaseClient();
  const { data: customer, error: fetchError } = await supabase
    .from("customers")
    .select("passport_photo_url, driver_license_photo_url, idp_photo_url")
    .eq("tenant_id", user.tenantId)
    .eq("id", customerId)
    .single();

  if (fetchError || !customer) {
    return NextResponse.json({ error: "Клиент не найден." }, { status: 404 });
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `customers/${customerId}/${field}/${Date.now()}-${safeName}`;
  const bucketError = await ensureCustomerDocumentsBucket(supabase);
  if (bucketError) {
    return NextResponse.json({ error: `Хранилище документов не готово: ${bucketError.message}` }, { status: 500 });
  }

  let { error: uploadError } = await supabase.storage.from(customerDocumentsBucket).upload(storagePath, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false
  });

  if (uploadError && /bucket|not found/i.test(uploadError.message)) {
    const retryBucketError = await ensureCustomerDocumentsBucket(supabase);
    if (!retryBucketError) {
      ({ error: uploadError } = await supabase.storage.from(customerDocumentsBucket).upload(storagePath, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false
      }));
    }
  }

  if (uploadError) {
    return NextResponse.json({ error: `Файл не загружен: ${uploadError.message}` }, { status: 400 });
  }

  const fileUrl = `${customerDocumentsBucket}:${storagePath}`;
  const currentValue = (customer as Record<string, unknown>)[dbField];
  const files = parseStoredDocuments(currentValue);
  files.push({
    url: fileUrl,
    name: file.name,
    type: file.type || "application/octet-stream"
  });

  const { error: updateError } = await supabase
    .from("customers")
    .update({ [dbField]: JSON.stringify(files) })
    .eq("tenant_id", user.tenantId)
    .eq("id", customerId);

  if (updateError) {
    await supabase.storage.from(customerDocumentsBucket).remove([storagePath]).catch(() => undefined);
    return NextResponse.json({ error: `Документ загружен, но не привязан к клиенту: ${updateError.message}` }, { status: 400 });
  }

  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/customers");
  revalidatePath("/launch");

  return NextResponse.json({
    data: {
      url: fileUrl,
      name: file.name,
      type: file.type || "application/octet-stream"
    },
    message: "Файл успешно загружен и привязан к клиенту."
  });
}
