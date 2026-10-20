import { draftMode } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  (await draftMode()).disable();
  const back = req.headers.get("referer");
  let target = "/";
  try { if (back) { const u = new URL(back); if (u.host === req.nextUrl.host) target = u.pathname; } } catch { /* ignore */ }
  return NextResponse.redirect(new URL(target, req.url));
}
