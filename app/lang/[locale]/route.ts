import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { localeCookieName } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n";

export async function GET(_request: Request, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const nextLocale: Locale = locale === "en" ? "en" : "ru";
  const cookieStore = await cookies();
  const headerStore = await headers();
  const referer = headerStore.get("referer");

  cookieStore.set(localeCookieName, nextLocale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax"
  });

  redirect(referer && referer.startsWith("http://127.0.0.1") ? referer : "/");
}
