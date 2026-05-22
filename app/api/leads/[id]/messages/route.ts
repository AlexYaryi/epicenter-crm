import { NextResponse } from "next/server";
import { getCurrentUserContext, getLeadMessages } from "@/lib/repository";
import { hasSupabaseEnv } from "@/lib/supabase";

type RouteParams = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: RouteParams) {
  if (!hasSupabaseEnv() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ data: [] });
  }

  const user = await getCurrentUserContext();
  if (user.supabaseConfigured && !user.isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const data = await getLeadMessages(id, user.tenantId);
  return NextResponse.json({ data });
}
