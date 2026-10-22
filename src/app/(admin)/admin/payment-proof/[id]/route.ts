import { NextResponse, type NextRequest } from "next/server";
import { can, getStaffUser } from "@/lib/auth";
import { createSessionClient } from "@/lib/admin";

/** Proof of payment of a notice (case file or, for notices on account, agent/<id>/… in the private bucket). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getStaffUser();
  if (!user || (!can.finance(user) && !(can.cases(user) && !can.caseStaff(user)))) return new NextResponse("Forbidden", { status: 403 });
  const db = await createSessionClient();
  const { data: n } = await db.from("case_payment_claims").select("case_id,proof_file_id,proof_path").eq("id", id).maybeSingle();
  if (!n) return new NextResponse("Not found", { status: 404 });
  let path: string | null = n.proof_path as string | null;
  let name = "payment-proof";
  if (!path && n.proof_file_id) {
    const { data: f } = await db.from("case_files").select("storage_path,filename").eq("id", n.proof_file_id).maybeSingle();
    path = (f?.storage_path as string) ?? null; name = (f?.filename as string) ?? name;
  } else if (path) name = path.split("/").pop() ?? name;
  if (!path) return new NextResponse("No proof attached", { status: 404 });
  const { data, error } = await db.storage.from("case-files").createSignedUrl(path, 120, { download: name });
  if (error || !data) return new NextResponse(`Download failed: ${error?.message ?? "unknown"}`, { status: 500 });
  return NextResponse.redirect(data.signedUrl, { headers: { "Cache-Control": "no-store" } });
}
