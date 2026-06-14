import { createClient } from "@supabase/supabase-js";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import WebSocket from "ws";

const defaultBuckets = [
  "vehicle-photos",
  "customer-documents",
  "handover-media",
  "return-media",
  "contracts",
  "avatars"
];

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function todayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function sanitizeStoragePath(path) {
  return path
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

async function listFilesRecursively(supabase, bucket, prefix = "") {
  const files = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, {
      limit,
      offset,
      sortBy: { column: "name", order: "asc" }
    });
    if (error) throw new Error(`${bucket}/${prefix}: ${error.message}`);
    const rows = data ?? [];

    for (const item of rows) {
      const itemPath = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id || item.metadata) {
        files.push({
          bucket,
          path: itemPath,
          size: item.metadata?.size ?? null,
          updated_at: item.updated_at ?? null
        });
      } else {
        files.push(...await listFilesRecursively(supabase, bucket, itemPath));
      }
    }

    if (rows.length < limit) break;
    offset += limit;
  }

  return files;
}

async function downloadObject(supabase, backupRoot, file) {
  const safePath = sanitizeStoragePath(file.path);
  const localPath = join(backupRoot, file.bucket, safePath);
  if (existsSync(localPath) && file.size !== null) return { ...file, local_path: localPath, skipped: true };

  mkdirSync(dirname(localPath), { recursive: true });
  const { data, error } = await supabase.storage.from(file.bucket).download(file.path);
  if (error) throw new Error(`${file.bucket}/${file.path}: ${error.message}`);
  await pipeline(data.stream(), createWriteStream(localPath));
  return { ...file, local_path: localPath, skipped: false };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  loadEnvFile(".env.local");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }

  const backupRoot = join(process.env.STORAGE_BACKUP_DIR || "/var/backups/epicenter-crm-storage", todayKey());
  const buckets = (process.env.STORAGE_BACKUP_BUCKETS || defaultBuckets.join(","))
    .split(",")
    .map((bucket) => bucket.trim())
    .filter(Boolean);
  const dryRun = process.argv.includes("--dry-run");
  const concurrency = Math.max(1, Number(process.env.STORAGE_BACKUP_CONCURRENCY ?? 6));
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
    realtime: { transport: WebSocket }
  });

  mkdirSync(backupRoot, { recursive: true });
  const manifest = {
    generated_at: new Date().toISOString(),
    backup_root: backupRoot,
    dry_run: dryRun,
    buckets: [],
    files: [],
    errors: []
  };

  for (const bucket of buckets) {
    try {
      const files = await listFilesRecursively(supabase, bucket);
      manifest.buckets.push({ bucket, files: files.length });
      const downloaded = await mapWithConcurrency(files, concurrency, async (file) => {
        try {
          return dryRun ? file : await downloadObject(supabase, backupRoot, file);
        } catch (error) {
          manifest.errors.push({ bucket, path: file.path, error: error instanceof Error ? error.message : String(error) });
          return null;
        }
      });
      manifest.files.push(...downloaded.filter(Boolean));
    } catch (error) {
      manifest.errors.push({ bucket, error: error instanceof Error ? error.message : String(error) });
    }
  }

  writeFileSync(join(backupRoot, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({
    ok: manifest.errors.length === 0,
    backup_root: backupRoot,
    buckets: manifest.buckets,
    files: manifest.files.length,
    errors: manifest.errors.length,
    dry_run: dryRun,
    concurrency
  }));

  if (manifest.errors.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
