"use client";

import { useMemo, useState } from "react";
import { ActionForm, SubmitButton, type ActionResult } from "./ActionForm";
import { CurrencySelect } from "./CurrencySelect";

type Action = (prev: ActionResult, fd: FormData) => Promise<ActionResult>;
type T = "agent" | "partner" | "ledger" | "cash";
export type JAccount = { key: string; type: T; id: string; name: string; sub: string; badge: string; currency: string | null; code?: string };
export type JDoc = { id: string; key: string; label: string; currency: string };
export type JTemplate = { key: string; en: string; ar: string; dr: string; cr: string; hint: string };

const norm = (s: string) => s.toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").trim();
const r2 = (n: number) => Math.round(n * 100) / 100;
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const EFFECT: Record<T, { dr: string; cr: string }> = {
  agent: { dr: "adds to what the agent owes · يزيد المستحق عليه", cr: "reduces what the agent owes · ينقص المستحق عليه" },
  partner: { dr: "reduces what RUKN owes them · ينقص المستحق له", cr: "adds to what RUKN owes them · يزيد المستحق له" },
  ledger: { dr: "debit to the account · مدين", cr: "credit to the account · دائن" },
  cash: { dr: "money comes INTO the box (receipt voucher) · يدخل الصندوق", cr: "money goes OUT of the box (payment voucher) · يخرج من الصندوق" },
};

function Picker({ id, label, accounts, value, onChange, only }: { id: string; label: string; accounts: JAccount[]; value: JAccount | null; onChange: (a: JAccount | null) => void; only?: T }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const pool = only ? accounts.filter((a) => a.type === only) : accounts;
  const q = norm(text);
  const list = (q ? pool.filter((a) => q.split(/\s+/).every((w) => norm(`${a.code ?? ""} ${a.name} ${a.sub} ${a.badge}`).includes(w))) : pool).slice(0, 40);
  const choose = (a: JAccount) => { onChange(a); setText(""); setOpen(false); };
  return (
    <div className="field full party-picker">
      <label htmlFor={id}>{label}</label>
      {value ? (
        <div className="picked">
          <span className={`pill ${value.type === "partner" ? "qualified" : value.type === "agent" ? "new" : value.type === "cash" ? "published" : "draft"}`}>{value.badge}</span><strong>{value.code ? `${value.code} · ` : ""}{value.name}</strong>{value.sub ? <span className="small muted"> · {value.sub}</span> : null}
          <button type="button" className="icon-btn" aria-label="Change" title="Change" onClick={() => onChange(null)}>✕</button>
        </div>
      ) : (
        <div style={{ position: "relative" }}>
          <input id={id} type="text" autoComplete="off" value={text} role="combobox" aria-expanded={open}
            placeholder={only === "agent" ? "Search an agent… · ابحث عن مندوب" : only === "partner" ? "Search a lab or clinic… · ابحث عن معمل أو عيادة" : only === "ledger" ? "Search an account… · ابحث عن حساب" : only === "cash" ? "Search a cash box… · ابحث عن صندوق" : "Agent, lab, clinic, cash box or account (name, code…) · ابحث"}
            onChange={(e) => { setText(e.target.value); setOpen(true); setHi(0); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (!open || !list.length) return;
              if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, list.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
              else if (e.key === "Enter") { e.preventDefault(); choose(list[hi]); }
            }} />
          {open && list.length ? (
            <ul className="picker-list" role="listbox">
              {list.map((a, i) => (
                <li key={a.key} role="option" aria-selected={i === hi} className={i === hi ? "hi" : undefined} onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); choose(a); }}>
                  <span className={`pill ${a.type === "partner" ? "qualified" : a.type === "agent" ? "new" : a.type === "cash" ? "published" : "draft"}`}>{a.badge}</span> <strong>{a.code ? `${a.code} · ` : ""}{a.name}</strong>{a.sub ? <span className="small muted"> · {a.sub}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** Simple journal entry (قيد بسيط): one debit account, one credit account, with currencies. */
export function JournalForm({ action, accounts, docs, templates, perUsd, preset }: {
  action: Action; accounts: JAccount[]; docs: JDoc[]; templates: JTemplate[]; perUsd: Record<string, number>; preset?: string;
}) {
  const byKey = (k?: string) => accounts.find((a) => a.key === k) ?? null;
  const byCode = (c: string) => accounts.find((a) => a.type === "ledger" && a.code === c) ?? null;
  const [tpl, setTpl] = useState<JTemplate | null>(null);
  const [dr, setDr] = useState<JAccount | null>(byKey(preset));
  const [cr, setCr] = useState<JAccount | null>(null);
  const [drCur, setDrCur] = useState(byKey(preset)?.currency ?? "USD");
  const [crCur, setCrCur] = useState(byKey(preset)?.currency ?? "USD");
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState<string | null>(null);
  const [crAmt, setCrAmt] = useState<string | null>(null);
  const [drDoc, setDrDoc] = useState(""); const [crDoc, setCrDoc] = useState("");
  const isT = (s: string): s is T => s === "agent" || s === "partner" || s === "ledger" || s === "cash";
  const onlyDr = tpl && isT(tpl.dr) ? tpl.dr : tpl ? "ledger" : undefined;
  const onlyCr = tpl && isT(tpl.cr) ? tpl.cr : tpl ? "ledger" : undefined;

  const applyTemplate = (t: JTemplate | null) => {
    setTpl(t); setDrDoc(""); setCrDoc(""); setRate(null); setCrAmt(null);
    if (!t) return;
    const pre = byKey(preset);
    setDr(isT(t.dr) ? (pre && pre.type === t.dr ? pre : null) : byCode(t.dr));
    setCr(isT(t.cr) ? (pre && pre.type === t.cr && !(isT(t.dr) && pre.type === t.dr) ? pre : null) : byCode(t.cr));
  };
  const setSide = (s: "dr" | "cr", a: JAccount | null) => {
    (s === "dr" ? setDr : setCr)(a); (s === "dr" ? setDrDoc : setCrDoc)("");
    if (a?.currency) { if (s === "dr") { setDrCur(a.currency); if (!cr || cr.type === "ledger") setCrCur(a.currency); } else { setCrCur(a.currency); if (!dr || dr.type === "ledger") setDrCur(a.currency); } }
    setRate(null); setCrAmt(null);
  };
  const swap = () => { setDr(cr); setCr(dr); setDrDoc(crDoc); setCrDoc(drDoc); setDrCur(crCur); setCrCur(drCur); setRate(null); setCrAmt(null); setTpl(null); };
  const auto = useMemo(() => (drCur === crCur ? 1 : perUsd[drCur] && perUsd[crCur] ? r6(perUsd[crCur] / perUsd[drCur]) : null), [drCur, crCur, perUsd]);
  const amt = Number(amount) || 0;
  const usedRate = crAmt !== null && amt ? r6(Number(crAmt) / amt) : rate !== null ? Number(rate) : auto;
  const shownCr = drCur === crCur ? amount : crAmt !== null ? crAmt : usedRate && amt ? String(r2(amt * usedRate)) : "";
  const docsOf = (a: JAccount | null) => (a && a.type !== "ledger" ? docs.filter((d) => d.key === a.key) : []);
  const reset = () => {
    setAmount(""); setRate(null); setCrAmt(null); setDrDoc(""); setCrDoc("");
    for (const id of ["jv-desc", "jv-ref"]) { const el = document.getElementById(id) as HTMLInputElement | null; if (el) el.value = ""; }
  };

  const sideBox = (s: "dr" | "cr") => {
    const a = s === "dr" ? dr : cr;
    const myDocs = docsOf(a);
    const doc = s === "dr" ? drDoc : crDoc;
    return (
      <div className={`jv-side ${s}`}>
        <h3>{s === "dr" ? "Debit · مدين (من حـ/)" : "Credit · دائن (إلى حـ/)"}</h3>
        <input type="hidden" name={s} value={a?.key ?? ""} />
        <Picker id={`jv-${s}`} label={s === "dr" ? "Debit account · الحساب المدين" : "Credit account · الحساب الدائن"} accounts={accounts} value={a} onChange={(x) => setSide(s, x)} only={s === "dr" ? onlyDr : onlyCr} />
        {a ? <p className="small muted" style={{ margin: "-4px 0 8px" }}>→ {EFFECT[a.type][s]}</p> : null}
        {s === "cr" && !a && dr ? <button type="button" className="btn secondary small" style={{ marginBottom: 8 }} onClick={() => { setCr(dr); setCrDoc(""); if (crCur === drCur) setCrCur(drCur === "USD" ? "EGP" : "USD"); setRate(null); setCrAmt(null); }}>= Same account in another currency · نفس الحساب بعملة أخرى</button> : null}
        {s === "cr" && a && dr && a.key === dr.key ? <p className="small" style={{ margin: "-4px 0 8px", color: drCur === crCur ? "#b42318" : "#067647" }}>{drCur === crCur ? "Same account on both sides: choose a different currency for the credit side. · نفس الحساب يتطلب عملة مختلفة" : "Currency conversion of the same account · تحويل عملة لنفس الحساب"}</p> : null}
        {myDocs.length ? (
          <div className="field full"><label htmlFor={`jv-${s}-doc`}>{a?.type === "agent" ? "On invoice (optional) · على فاتورة" : "On bill (optional) · على فاتورة الشريك"}</label>
            <select id={`jv-${s}-doc`} name={`${s}_doc`} value={doc} onChange={(e) => {
              (s === "dr" ? setDrDoc : setCrDoc)(e.target.value);
              const d = myDocs.find((x) => x.id === e.target.value);
              if (d) { (s === "dr" ? setDrCur : setCrCur)(d.currency); setRate(null); setCrAmt(null); }
            }}>
              <option value="">— the account, not one document —</option>
              {myDocs.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </div>
        ) : <input type="hidden" name={`${s}_doc`} value="" />}
        <div className="form-grid" style={{ gridTemplateColumns: "1fr 150px" }}>
          {s === "dr" ? (
            <div className="field"><label htmlFor="jv-amt">Amount · المبلغ *</label><input id="jv-amt" type="number" name="dr_amount" min="0.01" step="0.01" required value={amount} onChange={(e) => { setAmount(e.target.value); setCrAmt(null); }} /></div>
          ) : (
            <div className="field"><label htmlFor="jv-cramt">Amount · المبلغ</label>
              <input id="jv-cramt" type="number" name="cr_amount" min="0" step="0.01" value={shownCr} readOnly={drCur === crCur} onChange={(e) => setCrAmt(e.target.value)} />
              <input type="hidden" name="cr_edited" value={crAmt !== null && drCur !== crCur ? "1" : "0"} />
            </div>
          )}
          <div className="field"><label htmlFor={`jv-${s}-cur`}>Currency</label>
            <CurrencySelect id={`jv-${s}-cur`} name={`${s}_currency`} short options={Object.keys(perUsd)} value={s === "dr" ? drCur : crCur} locked={a?.type === "cash"} title={a?.type === "cash" ? "The currency of the cash box" : undefined}
              onChange={(e) => { (s === "dr" ? setDrCur : setCrCur)(e.target.value); setRate(null); setCrAmt(null); }} />
          </div>
        </div>
      </div>
    );
  };

  return (
    <ActionForm action={action} onSuccess={reset}>
      <div className="jv-templates">
        <span className="small muted">Quick patterns · نماذج جاهزة:</span>
        <button type="button" className={`btn small ${tpl ? "secondary" : ""}`} onClick={() => applyTemplate(null)}>Free entry · قيد حر</button>
        {templates.map((t) => <button key={t.key} type="button" className={`btn small ${tpl?.key === t.key ? "" : "secondary"}`} title={t.hint} onClick={() => applyTemplate(t)}>{t.ar}</button>)}
      </div>
      {tpl ? <p className="small muted">{tpl.en}: {tpl.hint}</p> : null}
      <div className="jv-sides">
        {sideBox("dr")}
        <button type="button" className="btn secondary small jv-swap" onClick={swap} title="Swap debit and credit">⇄</button>
        {sideBox("cr")}
      </div>
      {drCur !== crCur ? (
        <div className="field" style={{ maxWidth: 420 }}>
          <label htmlFor="jv-rate">Exchange rate · سعر الصرف: 1 {drCur} = ? {crCur} <span className={`pill ${rate !== null || crAmt !== null ? "changes" : "published"}`}>{rate !== null || crAmt !== null ? "edited · معدّل" : "automatic · تلقائي"}</span></label>
          <input id="jv-rate" type="number" name="rate" step="any" min="0" value={usedRate ? String(usedRate) : ""} placeholder={auto === null ? "no saved rate — type it" : ""} onChange={(e) => { setRate(e.target.value); setCrAmt(null); }} />
          {rate !== null || crAmt !== null ? <button type="button" className="btn secondary small" style={{ marginTop: 4 }} onClick={() => { setRate(null); setCrAmt(null); }}>↺ Automatic rate ({auto ?? "—"})</button> : null}
        </div>
      ) : null}
      <div className="form-grid">
        <div className="field"><label htmlFor="jv-date">Date · التاريخ</label><input id="jv-date" type="date" name="entry_date" defaultValue={new Date().toISOString().slice(0, 10)} /></div>
        <div className="field"><label htmlFor="jv-ref">Reference · مرجع</label><input id="jv-ref" type="text" name="reference" maxLength={120} /></div>
        <div className="field full"><label htmlFor="jv-desc">Description · البيان</label><input id="jv-desc" type="text" name="description" maxLength={500} placeholder="e.g. 10% loyalty discount on INV-26-00012 / set-off of planning fees against aligner invoice" /></div>
        <div className="full"><SubmitButton className="btn teal">Record entry · تسجيل القيد</SubmitButton></div>
      </div>
    </ActionForm>
  );
}
