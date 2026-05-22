"use server";

import { redirect } from "next/navigation";
import { createCookieSupabaseClient } from "./supabase-server";

export async function signInAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const supabase = await createCookieSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  redirect("/");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createCookieSupabaseClient();
  await supabase.auth.signOut();
  redirect("/login");
}

