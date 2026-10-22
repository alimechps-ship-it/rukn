"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { registerCaseFile } from "@/app/(admin)/admin/(panel)/_actions/cases";
import { submitPaymentNotice } from "@/app/(admin)/admin/(panel)/_actions/payments";
import { MAX_FILE_BYTES, PAYMENT_METHODS } from "@/lib/cases";

type Inv = { id: string; invoice_no: string; currency: string; balance: number };
const PROOF_EXT = ["pdf", "jpg", "jpeg", "png", "webp", "heic"];

/** Agent: "I sent a payment" — with the transfer details and a photo / PDF of the receipt. */
export function PaymentNoticeForm({ caseId, invoices, defaultCurrency }: { caseId: string; invoices: Inv[]; defaultCurrency: string }) {
  const open = invoices.filter((i) => i.balance > 0);
  const [invoiceId, setInvoiceId] = useState(open[0]?.id ?? "");
  const inv = invoices.find((i) => i.id === invoiceId);
  const [amount, setAmount] = useState(open[0] ? String(open[0].balance) : "");
  const [currency, setCurrency] = useState(open[0]?.currency ?? defaultCurrency);
  const [state, setState] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const router = useRouter();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true); setState(null);
    try {
      let proofFileId: string | null = null;
      const file = fd.get("proof") as File | null;
      if (file && file.size) {
        const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
        if (!PROOF_EXT.includes(ext)) { setState({ ok: false, message: "The proof must be a photo (JPG, PNG) or a PDF." }); return; }
        if (file.size > MAX_FILE_BYTES) { setState({ ok: false, message: "The proof file is larger than 50 MB." }); return; }
        const path = `${caseId}/${crypto.randomUUID()}.${ext}`;
        const { error } = await createBrowserSupabase().storage.from("case-files").upload(path, file, { contentType: file.type || "application/octet-stream" });
        if (error) { setState({ ok: false, message: `Upload of the proof failed: ${error.message}` }); return; }
        const reg = await registerCaseFile({ caseId, path, filename: file.name, size: file.size, mime: file.type, category: "payment_proof", deliverable: false });
        if (!reg.ok) { setState({ ok: false, message: reg.message }); return; }
        proofFileId = "fileId" in reg ? (reg.fileId as string) : null;
      }
      const res = await submitPaymentNotice({
        caseId, invoiceId: invoiceId || null, amount: Number(fd.get("amount")), currency: inv?.currency ?? currency,
        method: String(fd.get("method")), paidAt: String(fd.get("paid_at") ?? ""), reference: String(fd.get("reference") ?? ""),
        notes: String(fd.get("notes") ?? ""), proofFileId,
      });
      setState(res);
      if (res.ok) { form.current?.reset(); router.refresh(); }
    } finally { setBusy(false); }
  }

  return (
    <form ref={form} onSubmit={onSubmit} className="form-grid">
      {state ? <div className={`flash ${state.ok ? "ok" : "err"} full`} role={state.ok ? "status" : "alert"}>{state.message}</div> : null}
      {invoices.length ? (
        <div className="field full"><label htmlFor="pn-inv">For invoice · عن الفاتورة</label>
          <select id="pn-inv" value={invoiceId} onChange={(e) => {
            setInvoiceId(e.target.value);
            const i = invoices.find((x) => x.id === e.target.value);
            if (i) { setAmount(String(i.balance > 0 ? i.balance : "")); setCurrency(i.currency); }
          }}>
            <option value="">— not for a specific invoice —</option>
            {invoices.map((i) => <option key={i.id} value={i.id}>{i.invoice_no} · balance {i.balance.toFixed(2)} {i.currency}</option>)}
          </select>
        </div>
      ) : null}
      <div className="field"><label htmlFor="pn-amt">Amount paid · المبلغ *</label><input id="pn-amt" type="number" name="amount" min="0.01" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
      <div className="field"><label htmlFor="pn-cur">Currency · العملة</label><input id="pn-cur" type="text" maxLength={3} value={inv?.currency ?? currency} disabled={Boolean(inv)} onChange={(e) => setCurrency(e.target.value.toUpperCase())} /></div>
      <div className="field"><label htmlFor="pn-method">Paid by · طريقة الدفع</label>
        <select id="pn-method" name="method" defaultValue="bank_transfer">{Object.entries(PAYMENT_METHODS).map(([k, m]) => <option key={k} value={k}>{m.en} · {m.ar}</option>)}</select>
      </div>
      <div className="field"><label htmlFor="pn-date">Date of transfer · تاريخ التحويل</label><input id="pn-date" type="date" name="paid_at" defaultValue={new Date().toISOString().slice(0, 10)} /></div>
      <div className="field full"><label htmlFor="pn-ref">Transfer / transaction number · رقم التحويل</label><input id="pn-ref" type="text" name="reference" maxLength={120} placeholder="e.g. bank reference, InstaPay / Western Union number" /></div>
      <div className="field full"><label htmlFor="pn-proof">Proof of payment (photo or PDF) · صورة إيصال التحويل</label><input id="pn-proof" type="file" name="proof" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic" /></div>
      <div className="field full"><label htmlFor="pn-notes">Notes · ملاحظات</label><input id="pn-notes" type="text" name="notes" maxLength={500} /></div>
      <div className="full"><button className="btn teal" type="submit" disabled={busy}>{busy ? "Sending…" : "Send payment notice · إرسال إشعار الدفع"}</button></div>
    </form>
  );
}
