import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentUserContext } from "@/lib/repository";
import { createServiceSupabaseClient, hasSupabaseEnv } from "@/lib/supabase";

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: RouteParams) {
  if (!hasSupabaseEnv() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  const user = await getCurrentUserContext();
  if (!user.isAuthenticated || !["owner", "manager", "marketer"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const { id } = await params;
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "No file selected." }, { status: 400 });
  }

  const supabase = createServiceSupabaseClient();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${id}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;

  const uploadOptions = {
    contentType: file.type || "image/jpeg",
    upsert: false
  };
  let { error: uploadError } = await supabase.storage.from("vehicle-photos").upload(path, file, uploadOptions);

  if (uploadError && /bucket|not found/i.test(uploadError.message)) {
    const { error: bucketError } = await supabase.storage.createBucket("vehicle-photos", {
      public: true,
      fileSizeLimit: "8MB",
      allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"]
    });
    if (bucketError && !/already exists/i.test(bucketError.message)) {
      return NextResponse.json({ error: bucketError.message }, { status: 400 });
    }
    ({ error: uploadError } = await supabase.storage.from("vehicle-photos").upload(path, file, uploadOptions));
  }

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 400 });
  }

  const { data: publicUrl } = supabase.storage.from("vehicle-photos").getPublicUrl(path);
  const url = publicUrl.publicUrl;
  const { data: vehicle, error: readError } = await supabase
    .from("vehicles")
    .select("photos")
    .eq("id", id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();

  if (readError || !vehicle) {
    return NextResponse.json({ error: readError?.message ?? "Vehicle not found." }, { status: 404 });
  }

  const photos = Array.isArray(vehicle.photos) ? vehicle.photos : [];
  const { error } = await supabase
    .from("vehicles")
    .update({ photos: [...photos, url] })
    .eq("id", id)
    .eq("tenant_id", user.tenantId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  revalidatePath("/fleet");
  revalidatePath(`/fleet/${id}`);
  revalidatePath("/api/tilda/vehicles");

  return NextResponse.json({ url });
}
