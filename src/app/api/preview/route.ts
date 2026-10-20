import { draftMode } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createSessionClient } from "@/lib/supabase/server";

/** Enables draft preview for signed-in staff only, then redirects to the page. */
export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path") ?? "/";
  const safePath = path.startsWith("/") && !path.startsWith("//") ? path : "/";
  const db = await createSessionClient();
  const { data } = await db.rpc("is_staff");
  if (data !== true) return NextResponse.redirect(new URL(`/admin/login?next=${encodeURIComponent("/api/preview?path=" + safePath)}`, req.url));
  (await draftMode()).enable();
  return NextResponse.redirect(new URL(safePath, req.url));
}
