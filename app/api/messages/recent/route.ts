import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabaseClient, hasSupabaseEnv } from "@/lib/supabase";
import { getCurrentUserContext } from "@/lib/repository";

export const revalidate = 0;

export async function GET(request: NextRequest) {
  const user = await getCurrentUserContext();

  if (user.supabaseConfigured && !user.isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasSupabaseEnv() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ data: [], unread_count: 0, latest_at: null });
  }

  const since = request.nextUrl.searchParams.get("since");
  const supabase = createServiceSupabaseClient();

  const { data, error } = await supabase
    .from("conversation_messages")
    .select("id, customer_id, channel, sender_name, contact_handle, message_text, status, occurred_at, customers(full_name)")
    .eq("tenant_id", user.tenantId)
    .eq("direction", "inbound")
    .order("occurred_at", { ascending: false })
    .limit(12);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const messages = (data || []).map((message) => {
    const customerJoin = message.customers as { full_name?: string } | { full_name?: string }[] | null;
    return {
      id: message.id,
      customer_id: message.customer_id,
      customer_name: Array.isArray(customerJoin) ? customerJoin[0]?.full_name : customerJoin?.full_name,
      channel: message.channel,
      sender_name: message.sender_name,
      contact_handle: message.contact_handle,
      message_text: message.message_text,
      status: message.status,
      occurred_at: message.occurred_at
    };
  });

  const unreadCount = since ? messages.filter((message) => message.occurred_at > since).length : 0;

  return NextResponse.json({
    data: messages,
    unread_count: unreadCount,
    latest_at: messages[0]?.occurred_at ?? null
  });
}
