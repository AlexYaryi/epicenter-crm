import { NextResponse } from "next/server";
import { getCurrentUserContext } from "@/lib/repository";
import { createServiceSupabaseClient, hasSupabaseEnv } from "@/lib/supabase";

export const revalidate = 0;
export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ id: string }>;
};

// Generates temporary signed URLs (1 hour) for customer document photos
// stored in private Supabase storage buckets.
//
// The stored value can be either:
//   1. "bucket:path/to/file"  (new format after fix)
//   2. A full Supabase storage URL (old format – parsed automatically)
export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params;

  const user = await getCurrentUserContext();
  if (user.supabaseConfigured && !user.isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasSupabaseEnv()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const supabase = createServiceSupabaseClient();

  // Fetch customer record
  const { data: customer, error } = await supabase
    .from("customers")
    .select("id, passport_photo_url, driver_license_photo_url, idp_photo_url, tenant_id")
    .eq("id", id)
    .eq("tenant_id", user.tenantId)
    .single();

  if (error || !customer) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  async function getSignedUrl(rawUrl: string | null): Promise<string | null> {
    if (!rawUrl) return null;

    let bucket: string;
    let path: string;

    // New format: "bucket:path/to/file"
    if (!rawUrl.startsWith("http") && rawUrl.includes(":")) {
      const colonIdx = rawUrl.indexOf(":");
      bucket = rawUrl.slice(0, colonIdx);
      path = rawUrl.slice(colonIdx + 1);
    }
    // Old format: full Supabase storage URL
    else if (rawUrl.includes("/storage/v1/object/")) {
      const match = rawUrl.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+)/);
      if (!match) return null;
      bucket = match[1];
      path = match[2].split("?")[0]; // strip existing query params
    } else {
      // Unknown format – return as-is (might be a direct external URL)
      return rawUrl;
    }

    const { data, error: signError } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, 3600); // 1 hour validity

    if (signError || !data) {
      console.error(`Failed to create signed URL for ${bucket}/${path}:`, signError?.message);
      return null;
    }

    return data.signedUrl;
  }

  async function getSignedFiles(rawUrl: string | null): Promise<{ url: string; signedUrl: string; name: string; type: string }[]> {
    if (!rawUrl) return [];

    let parsed: any[] = [];
    try {
      if (rawUrl.startsWith("[") && rawUrl.endsWith("]")) {
        parsed = JSON.parse(rawUrl);
      } else {
        parsed = [{ url: rawUrl, name: "Document", type: "image/jpeg" }];
      }
    } catch {
      parsed = [{ url: rawUrl, name: "Document", type: "image/jpeg" }];
    }

    const signed = await Promise.all(
      parsed.map(async (file: any) => {
        const url = file.url || file;
        const name = file.name || "Document";
        const type = file.type || (url.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg");
        const signedUrl = await getSignedUrl(url);
        return { url, signedUrl: signedUrl || "", name, type };
      })
    );

    return signed.filter((f) => !!f.signedUrl);
  }

  const [passportFiles, licenseFiles, idpFiles] = await Promise.all([
    getSignedFiles(customer.passport_photo_url),
    getSignedFiles(customer.driver_license_photo_url),
    getSignedFiles(customer.idp_photo_url),
  ]);

  return NextResponse.json(
    {
      passport_photo_url: passportFiles[0]?.signedUrl || null,
      passport_files: passportFiles,
      driver_license_photo_url: licenseFiles[0]?.signedUrl || null,
      driver_license_files: licenseFiles,
      idp_photo_url: idpFiles[0]?.signedUrl || null,
      idp_files: idpFiles,
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}
