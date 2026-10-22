"use client";

import { useMemo, useState } from "react";
import { ActionForm, SubmitButton, type ActionResult } from "./ActionForm";

type Action = (prev: ActionResult, fd: FormData) => Promise<ActionResult>;
type Box = { id: string; name: string; currency: string; balance: number };

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Transfer between cash boxes. When the currencies differ the automatic rate
 * (from Finance → Exchange rates) is proposed; the user may change the rate
 * or type the received amount — the other one follows.
 */
export function TransferForm({ action, boxes, perUsd }: { action: Action; boxes: Box[]; perUsd: Record<string, number> }) {
  const [from, setFrom] = useState(boxes[0]?.id ?? "");
  const [to, setTo] = useState(boxes[1]?.id ?? boxes[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState<string | null>(null); // null = automatic
  const [received, setReceived] = useState<string | null>(null); // null = computed
  const a = boxes.find((b) => b.id === from);
  const b = boxes.find((x) => x.id === to);
  const fx = a && b && a.currency !== b.currency;
  const auto = useMemo(() => {
    if (!a || !b) return null;
    if (a.currency === b.currency) return 1;
    const f = perUsd[a.currency]; const t = perUsd[b.currency];
    return f && t ? r6(t / f) : null;
  }, [a, b, perUsd]);
  const amt = Number(amount) || 0;
  const usedRate = received !== null && amt > 0 ? r6(Number(received) / amt) : rate !== null ? Number(rate) : auto;
  const toAmount = received !== null ? received : usedRate && amt ? String(r2(amt * usedRate)) : "";
  const manual = fx && (rate !== null || received !== null) && usedRate !== auto;
  const reset = () => { setRate(null); setReceived(null); };

  return (
    <ActionForm action={action} className="form-grid" onSuccess={() => { setAmount(""); reset(); }}>
      {fx ? <><input type="hidden" name="rate_from" value={a!.currency} /><input type="hidden" name="rate_to" value={b!.currency} /></> : null}
      <div className="field"><label htmlFor="tr-from">From · من</label>
        <select id="tr-from" name="from" value={from} onChange={(e) => { setFrom(e.target.value); reset(); }}>
          {boxes.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.currency})</option>)}
        </select>
      </div>
      <div className="field"><label htmlFor="tr-to">To · إلى</label>
        <select id="tr-to" name="to" value={to} onChange={(e) => { setTo(e.target.value); reset(); }}>
          {boxes.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.currency})</option>)}
        </select>
      </div>
      <div className="field"><label htmlFor="tr-amt">Amount sent{a ? ` (${a.currency})` : ""} *</label>
        <input id="tr-amt" type="number" name="amount" min="0.01" step="0.01" required value={amount} onChange={(e) => { setAmount(e.target.value); setReceived(null); }} />
      </div>
      {fx ? (
        <>
          <div className="field">
            <label htmlFor="tr-rate">Exchange rate · سعر الصرف <span className={`pill ${manual ? "changes" : "published"}`}>{manual ? "edited · معدّل" : "automatic · تلقائي"}</span></label>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span className="small nowrap">1 {a!.currency} =</span>
              <input id="tr-rate" type="number" name="rate" min="0" step="any" value={usedRate ? String(usedRate) : ""} placeholder={auto === null ? "no rate saved" : ""}
                onChange={(e) => { setRate(e.target.value); setReceived(null); }} />
              <span className="small nowrap">{b!.currency}</span>
            </div>
            {auto === null ? <span className="small" style={{ color: "#b42318" }}>No saved rate for {a!.currency}/{b!.currency} — type it, or add it under Exchange rates.</span>
              : manual ? <button type="button" className="btn secondary small" style={{ marginTop: 4 }} onClick={reset}>↺ Use automatic rate ({auto})</button>
              : <span className="small muted">1 {b!.currency} = {r6(1 / auto)} {a!.currency}</span>}
          </div>
          <div className="field"><label htmlFor="tr-amt2">Amount received ({b!.currency}) · المبلغ المستلم</label>
            <input id="tr-amt2" type="number" name="amount_to" min="0" step="0.01" value={toAmount} onChange={(e) => setReceived(e.target.value)} />
            <input type="hidden" name="to_edited" value={received !== null ? "1" : "0"} />
            <span className="small muted">Change the rate or the received amount — the other follows.</span>
          </div>
        </>
      ) : null}
      <div className="field"><label htmlFor="tr-date">Date</label><input id="tr-date" type="date" name="entry_date" defaultValue={new Date().toISOString().slice(0, 10)} /></div>
      <div className="field"><label htmlFor="tr-desc">Description</label><input id="tr-desc" type="text" name="description" maxLength={500} placeholder="e.g. deposit cash to bank" /></div>
      <div className="full"><SubmitButton className="btn secondary">Record transfer</SubmitButton></div>
    </ActionForm>
  );
}
