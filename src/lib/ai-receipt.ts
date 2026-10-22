import "server-only";
import type { Db } from "./admin";
import { callClaude, isAiConfigured, logUsage, type ContentBlock } from "./ai";

/**
 * Reads the transfer receipt attached to a payment notice and compares it with
 * what the agent typed. Result is stored on the notice (ai_status, ai_extracted,
 * ai_summary) through the set_claim_ai RPC. It never accepts or rejects anything:
 * the case manager decides.
 */
const IMAGE_TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
const MAX_IMAGE = 4.5 * 1024 * 1024;
const MAX_PDF = 20 * 1024 * 1024;

type Extracted = {
  readable: boolean; amount: number | null; currency: string | null; date: string | null; reference: string | null;
  sender: string | null; receiver: string | null; bank_or_service: string | null; notes: string | null;
};

const TOOL = {
  name: "record_receipt",
  description: "Record what is written on the payment / transfer receipt.",
  input_schema: {
    type: "object",
    properties: {
      readable: { type: "boolean", description: "false if the image is not a payment receipt or cannot be read" },
      amount: { type: ["number", "null"], description: "Amount transferred, as a number (no thousands separators)" },
      currency: { type: ["string", "null"], description: "ISO 4217 code, e.g. USD, EGP, EUR, SAR" },
      date: { type: ["string", "null"], description: "Transfer date YYYY-MM-DD" },
      reference: { type: ["string", "null"], description: "Transaction / reference number" },
      sender: { type: ["string", "null"] }, receiver: { type: ["string", "null"] },
      bank_or_service: { type: ["string", "null"], description: "Bank, InstaPay, Western Union, wallet…" },
      notes: { type: ["string", "null"], description: "Anything unusual (edited image, partial, different beneficiary…)" },
    },
    required: ["readable", "amount", "currency", "date", "reference"],
  },
};

const norm = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export function compareReceipt(x: Extracted, n: { amount: number; currency: string; paid_at: string; reference: string | null }) {
  if (!x.readable) return { status: "unreadable" as const, summary: "تعذّرت قراءة الإيصال — راجعه يدوياً. · The receipt could not be read — check it manually." };
  const issues: string[] = [];
  if (x.amount === null) issues.push("المبلغ غير واضح في الإيصال · amount not readable");
  else if (Math.abs(Number(x.amount) - Number(n.amount)) > 0.01) issues.push(`المبلغ في الإيصال ${x.amount} ${x.currency ?? ""} بينما الإشعار ${n.amount} ${n.currency} · amount differs`);
  if (x.currency && x.currency.toUpperCase() !== n.currency) issues.push(`العملة في الإيصال ${x.currency} بدلاً من ${n.currency} · currency differs`);
  if (x.date && /^\d{4}-\d{2}-\d{2}$/.test(x.date)) {
    const d = Math.abs(Date.parse(`${x.date}T00:00:00Z`) - Date.parse(`${n.paid_at}T00:00:00Z`)) / 86400000;
    if (d > 3) issues.push(`تاريخ الإيصال ${x.date} يختلف عن ${n.paid_at} · date differs by ${Math.round(d)} days`);
  }
  if (n.reference && x.reference) {
    const a = norm(n.reference), b = norm(x.reference);
    if (a && b && !a.includes(b) && !b.includes(a)) issues.push(`رقم التحويل في الإيصال ${x.reference} لا يطابق ${n.reference} · reference differs`);
  }
  if (x.notes) issues.push(`ملاحظة: ${x.notes}`);
  const hard = issues.filter((i) => !i.startsWith("ملاحظة"));
  if (!hard.length) {
    return { status: "match" as const, summary: `✓ الإيصال مطابق: ${x.amount} ${x.currency ?? n.currency}${x.date ? ` بتاريخ ${x.date}` : ""}${x.reference ? ` · رقم ${x.reference}` : ""}${x.bank_or_service ? ` · ${x.bank_or_service}` : ""}${issues.length ? ` — ${issues.join(" — ")}` : ""}` };
  }
  return { status: "mismatch" as const, summary: `⚠ ${issues.join(" — ")}` };
}

/** db must be allowed to read the file and call set_claim_ai (case staff session or service role). */
export async function checkReceipt(db: Db, claimId: string, usageUser: string | null, usageDb?: Db) {
  if (!isAiConfigured()) return { ok: false, message: "AI is not set up (ANTHROPIC_API_KEY)." };
  const { data: n } = await db.from("case_payment_claims").select("id,amount,currency,paid_at,reference,proof_file_id,proof_path").eq("id", claimId).maybeSingle();
  if (!n) return { ok: false, message: "Payment notice not found." };
  if (!n.proof_file_id && !n.proof_path) return { ok: false, message: "No proof attached to this notice." };
  // proof on a case (case file) or on the agent's account (agent/<id>/<file>)
  const { data: f } = n.proof_path
    ? { data: { storage_path: n.proof_path as string, filename: String(n.proof_path).split("/").pop() as string } }
    : await db.from("case_files").select("storage_path,filename").eq("id", n.proof_file_id).maybeSingle();
  if (!f) return { ok: false, message: "Proof file not found." };
  const ext = String(f.filename).split(".").pop()?.toLowerCase() ?? "";
  const save = async (status: string, extracted: unknown, summary: string) => {
    const { error } = await db.rpc("set_claim_ai", { p_claim: claimId, p_status: status, p_extracted: extracted, p_summary: summary });
    if (error) throw new Error(error.message);
  };
  if (!(ext in IMAGE_TYPES) && ext !== "pdf") {
    await save("unreadable", null, "نوع الملف لا يُقرأ آلياً (HEIC أو غيره) — راجعه يدوياً. · File type cannot be read automatically.");
    return { ok: true, message: "File type cannot be read automatically." };
  }
  const { data: blob, error: dlErr } = await db.storage.from("case-files").download(f.storage_path);
  if (dlErr || !blob) return { ok: false, message: `Could not open the proof: ${dlErr?.message ?? "unknown"}` };
  const buf = Buffer.from(await blob.arrayBuffer());
  if ((ext === "pdf" && buf.length > MAX_PDF) || (ext !== "pdf" && buf.length > MAX_IMAGE)) {
    await save("unreadable", null, "الملف كبير جداً للقراءة الآلية — راجعه يدوياً. · File too large to read automatically.");
    return { ok: true, message: "File too large." };
  }
  const attachment: ContentBlock = ext === "pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") } }
    : { type: "image", source: { type: "base64", media_type: IMAGE_TYPES[ext], data: buf.toString("base64") } };
  try {
    const res = await callClaude({
      system: "You read bank-transfer and payment receipts (Arabic or English, any country: banks, InstaPay, Vodafone Cash, Western Union, wallets). Report exactly what is written; never guess missing values (use null). Convert Arabic-Indic digits to Western digits.",
      messages: [{ role: "user", content: [attachment, { type: "text", text: "Read this payment receipt and record it with the tool." }] }],
      tools: [TOOL], toolChoice: { type: "tool", name: "record_receipt" }, maxTokens: 600,
    });
    await logUsage(usageDb ?? db, usageUser, "receipt", res.usage);
    const call = res.content.find((b) => b.type === "tool_use") as Extract<ContentBlock, { type: "tool_use" }> | undefined;
    if (!call) { await save("error", null, "لم يُرجع الذكاء الاصطناعي نتيجة. · No result from AI."); return { ok: false, message: "No result." }; }
    const x = call.input as unknown as Extracted;
    const cmp = compareReceipt({ ...x, amount: x.amount === null || x.amount === undefined ? null : Number(x.amount) }, { amount: Number(n.amount), currency: n.currency as string, paid_at: n.paid_at as string, reference: n.reference as string | null });
    await save(cmp.status, x, cmp.summary);
    return { ok: true, message: cmp.summary };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "AI error";
    await save("error", null, `تعذر الفحص الآلي: ${msg}`.slice(0, 900)).catch(() => undefined);
    return { ok: false, message: msg };
  }
}
