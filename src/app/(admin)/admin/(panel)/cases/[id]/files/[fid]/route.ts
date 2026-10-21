import { NextResponse, type NextRequest } from "next/server";
import { can, getStaffUser } from "@/lib/auth";
import { createSessionClient } from "@/lib/admin";

/** Short-lived signed download link for a clinical file (private bucket, RLS-checked). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; fid: string }> }) {
  const { id, fid } = await params;
  const user = await getStaffUser();
  if (!user || !can.staff(user) || !can.cases(user)) return new NextResponse("Forbidden", { status: 403 });
  const db = await createSessionClient();
  const { data: f } = await db.from("case_files").select("storage_path,filename").eq("id", fid).eq("case_id", id).maybeSingle();
  if (!f) return new NextResponse("Not found", { status: 404 });
  const { data, error } = await db.storage.from("case-files").createSignedUrl(f.storage_path, 120, { download: f.filename });
  if (error || !data) return new NextResponse(`Download failed: ${error?.message ?? "unknown"}`, { status: 500 });
  return NextResponse.redirect(data.signedUrl, { headers: { "Cache-Control": "no-store" } });
}
