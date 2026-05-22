import { NextResponse } from "next/server";
import { getCurrentUserContext, getCustomerMessages } from "@/lib/repository";

export const revalidate = 0;
export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  const user = await getCurrentUserContext();

  if (user.supabaseConfigured && !user.isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const messages = await getCustomerMessages(id, user.tenantId);
  return NextResponse.json(
    { data: messages },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0"
      }
    }
  );
}
