"use client";

import { useMemo, useState } from "react";
import { ActionForm, SubmitButton, type ActionResult } from "./ActionForm";

type Action = (prev: ActionResult, fd: FormData) => Promise<ActionResult>;
export type AdjAccount = { key: string; type: "agent" | "partner"; id: string; name: string; sub: string; badge: string; currency: string | null };
export type AdjDoc = { id: string; key: string; no: string; label: string; currency: string; due: number };
type KindDef = { en: string; ar: string; party: "agent" | "partner" | "any"; effect?: "increase" | "decrease"; hint: string };

const EFFECT = {
  agent: { increase: "Increases what the agent owes · يزيد المستحق عليه", decrease: "Reduces what the agent owes · ينقص المستحق عليه" },
  partner: { increase: "Increases what RUKN owes them · يزيد المستحق له", decrease: "Reduces what RUKN owes them · ينقص المستحق له" },
};
const norm = (s: string) => s.toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").trim();
const r2 = (n: number) => Math.round(n * 100) / 100;
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const today = () => new Date().toISOString().slice(0, 10);

/** Searchable account (agent or lab / clinic). */
function AccountPicker({ id, name, label, accounts, value, onChange, only }: {
  id: string; name: string; label: string; accounts: AdjAccount[]; value: AdjAccount | null; onChange: (a: AdjAccount | null) => void; only?: "agent" | "partner";
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const pool = only ? accounts.filter((a) => a.type === only) : accounts;
  const q = norm(text);
  const list = (q ? pool.filter((a) => q.split(/\s+/).every((w) => norm(`${a.name} ${a.sub} ${a.badge}`).includes(w))) : pool).slice(0, 30);
  return (
    <div className="field full party-picker">
      <label htmlFor={id}>{label}</label>
      <input type="hidden" name={name} value={value ? `${value.type}:${value.id}` : ""} />
      {value ? (
        <div className="picked">
          <span className={`pill ${value.type === "partner" ? "qualified" : "new"}`}>{value.badge}</span><strong>{value.name}</strong>{value.sub ? <span className="small muted"> · {value.sub}</span> : null}
          <button type="button" className="icon-btn" aria-label="Change" title="Change" onClick={() => onChange(null)}>✕</button>
        </div>
      ) : (
        <div style={{ position: "relative" }}>
          <input id={id} type="text" autoComplete="off" value={text} role="combobox" aria-expanded={open}
            placeholder={only === "agent" ? "Search an agent… · ابحث عن مندوب" : only === "partner" ? "Search a lab or clinic… · ابحث عن معمل أو عيادة" : "Search an agent, lab or clinic… · ابحث عن مندوب أو معمل أو عيادة"}
            onChange={(e) => { setText(e.target.value); setOpen(true); setHi(0); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (!open || !list.length) return;
              if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, list.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
              else if (e.key === "Enter") { e.preventDefault(); onChange(list[hi]); setText(""); setOpen(false); }
            }} />
          {open && list.length ? (
            <ul className="picker-list" role="listbox">
              {list.map((a, i) => (
                <li key={a.key} role="option" aria-selected={i === hi} className={i === hi ? "hi" : undefined} onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); onChange(a); setText(""); setOpen(false); }}>
                  <span className={`pill ${a.type === "partner" ? "qualified" : "new"}`}>{a.badge}</span> <strong>{a.name}</strong>{a.sub ? <span className="small muted"> · {a.sub}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </div>
  );
}

function DocSelect({ id, name, docs, acc, onPick }: { id: string; name: string; docs: AdjDoc[]; acc: AdjAccount | null; onPick: (d: AdjDoc | undefined) => void }) {
  const mine = acc ? docs.filter((d) => d.key === `${acc.type}:${acc.id}`) : [];
  if (!mine.length) return <input type="hidden" name={name} value="" />;
  return (
    <div className="field"><label htmlFor={id}>{acc?.type === "agent" ? "On invoice (optional) · على فاتورة" : "On bill (optional) · على فاتورة الشريك"}</label>
      <select id={id} name={name} defaultValue="" onChange={(e) => onPick(mine.find((d) => d.id === e.target.value))}>
        <option value="">— on the account, not one document —</option>
        {mine.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
      </select>
    </div>
  );
}

export function AdjustmentForm({ adjust, offset, kinds, accounts, docs, perUsd, preset }: {
  adjust: Action; offset: Action; kinds: Record<string, KindDef>; accounts: AdjAccount[]; docs: AdjDoc[]; perUsd: Record<string, number>; preset?: string;
}) {
  const [mode, setMode] = useState<"adjust" | "offset">("adjust");
  const [kind, setKind] = useState("discount_allowed");
  const presetAcc = accounts.find((a) => a.key === preset) ?? null;
  const [acc, setAcc] = useState<AdjAccount | null>(presetAcc);
  const [cur, setCur] = useState(presetAcc?.currency ?? "USD");
  const [amount, setAmount] = useState("");
  const [effect, setEffect] = useState<"increase" | "decrease">("decrease");
  // offset
  const [a, setA] = useState<AdjAccount | null>(presetAcc);
  const [b, setB] = useState<AdjAccount | null>(null);
  const [curB, setCurB] = useState("USD");
  const [rate, setRate] = useState<string | null>(null);
  const [amtB, setAmtB] = useState<string | null>(null);
  const [omode, setOmode] = useState<"net" | "move">("net");
  const k = kinds[kind];
  const only = k?.party === "any" ? undefined : k?.party;
  const fixedEffect = k?.effect;
  const pickAcc = (x: AdjAccount | null) => { setAcc(x); if (x?.currency) setCur(x.currency); };
  const autoRate = useMemo(() => (cur === curB ? 1 : perUsd[cur] && perUsd[curB] ? r6(perUsd[curB] / perUsd[cur]) : null), [cur, curB, perUsd]);
  const amt = Number(amount) || 0;
  const usedRate = amtB !== null && amt ? r6(Number(amtB) / amt) : rate !== null ? Number(rate) : autoRate;
  const shownB = amtB !== null ? amtB : usedRate && amt ? String(r2(amt * usedRate)) : "";
  const reset = () => {
    setAmount(""); setRate(null); setAmtB(null);
    // free-text fields are not controlled: clear them so they do not carry over to the next entry
    for (const id of ["aj-desc", "aj-ref", "of-desc", "of-ref"]) { const el = document.getElementById(id) as HTMLInputElement | null; if (el) el.value = ""; }
  };

  return (
    <>
      <div className="btn-row" style={{ marginBottom: 12 }}>
        <button type="button" className={`btn small ${mode === "adjust" ? "" : "secondary"}`} onClick={() => setMode("adjust")}>Discount / addition / difference · خصم أو إضافة أو فروق</button>
        <button type="button" className={`btn small ${mode === "offset" ? "" : "secondary"}`} onClick={() => setMode("offset")}>Offset between accounts · تقاص</button>
      </div>
      {mode === "adjust" ? (
        <ActionForm action={adjust} className="form-grid" onSuccess={reset}>
          <div className="field full"><label htmlFor="aj-kind">Type · النوع</label>
            <select id="aj-kind" name="kind" value={kind} onChange={(e) => { setKind(e.target.value); const nk = kinds[e.target.value]; if (nk?.party !== "any" && acc && acc.type !== nk?.party) setAcc(null); }}>
              {Object.entries(kinds).filter(([key]) => key !== "offset").map(([key, d]) => <option key={key} value={key}>{d.ar} · {d.en}</option>)}
            </select>
            <span className="small muted">{k?.hint}</span>
          </div>
          <AccountPicker id="aj-party" name="party" label={only === "agent" ? "Agent · المندوب" : only === "partner" ? "Lab / clinic · المعمل أو العيادة" : "Account · الحساب (مندوب، معمل، عيادة)"} accounts={accounts} value={acc} onChange={pickAcc} only={only} />
          {acc ? (
            <div className="field full">
              <label>Effect · الأثر على الرصيد</label>
              {fixedEffect ? <div className="small"><strong>{EFFECT[acc.type][fixedEffect]}</strong><input type="hidden" name="effect" value={fixedEffect} /></div> : (
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                  {(["increase", "decrease"] as const).map((e) => (
                    <label key={e} className="small" style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="radio" name="effect" value={e} checked={effect === e} onChange={() => setEffect(e)} /> {EFFECT[acc.type][e]}</label>
                  ))}
                </div>
              )}
            </div>
          ) : null}
          <DocSelect id="aj-doc" name="doc" docs={docs} acc={acc} onPick={(d) => { if (d) setCur(d.currency); }} />
          <div className="field"><label htmlFor="aj-amt">Amount · المبلغ *</label><input id="aj-amt" type="number" name="amount" min="0.01" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div className="field"><label htmlFor="aj-cur">Currency · العملة</label><input id="aj-cur" type="text" name="currency" maxLength={3} value={cur} onChange={(e) => setCur(e.target.value.toUpperCase())} /></div>
          <div className="field"><label htmlFor="aj-date">Date · التاريخ</label><input id="aj-date" type="date" name="adj_date" defaultValue={today()} /></div>
          <div className="field"><label htmlFor="aj-ref">Reference · مرجع</label><input id="aj-ref" type="text" name="reference" maxLength={120} /></div>
          <div className="field full"><label htmlFor="aj-desc">Description · البيان</label><input id="aj-desc" type="text" name="description" maxLength={500} placeholder="e.g. 5% early-payment discount / extra retainer set / USD→EGP rate difference" /></div>
          <div className="full"><SubmitButton className="btn teal">Record adjustment · تسجيل التسوية</SubmitButton></div>
        </ActionForm>
      ) : (
        <ActionForm action={offset} className="form-grid" onSuccess={reset}>
          <div className="field full">
            <label>Offset type · نوع التقاص</label>
            <div style={{ display: "grid", gap: 6 }}>
              <label className="small" style={{ display: "flex", gap: 6 }}><input type="radio" name="mode" value="net" checked={omode === "net"} onChange={() => setOmode("net")} /> <span><strong>Set off · مقاصة</strong> — what account A owes RUKN is settled against what RUKN owes account B (both balances go down). E.g. a clinic that is both a client (via an agent) and a planner.</span></label>
              <label className="small" style={{ display: "flex", gap: 6 }}><input type="radio" name="mode" value="move" checked={omode === "move"} onChange={() => setOmode("move")} /> <span><strong>Move a balance · نقل رصيد</strong> — the amount leaves account A and is charged to account B (A goes down, B goes up). E.g. one agent takes over another agent&apos;s debt.</span></label>
            </div>
          </div>
          <AccountPicker id="of-a" name="a_party" label="Account A · الحساب الأول" accounts={accounts} value={a} onChange={(x) => { setA(x); if (x?.currency) setCur(x.currency); }} />
          <DocSelect id="of-da" name="doc_a" docs={docs} acc={a} onPick={(d) => { if (d) { setCur(d.currency); } }} />
          <AccountPicker id="of-b" name="b_party" label="Account B · الحساب الثاني" accounts={accounts} value={b} onChange={(x) => { setB(x); if (x?.currency) setCurB(x.currency); setRate(null); setAmtB(null); }} />
          <DocSelect id="of-db" name="doc_b" docs={docs} acc={b} onPick={(d) => { if (d) { setCurB(d.currency); setRate(null); setAmtB(null); } }} />
          <div className="field"><label htmlFor="of-amt">Amount on A · المبلغ *</label><input id="of-amt" type="number" name="amount" min="0.01" step="0.01" required value={amount} onChange={(e) => { setAmount(e.target.value); setAmtB(null); }} /></div>
          <div className="field"><label htmlFor="of-cur">Currency of A</label><input id="of-cur" type="text" name="currency" maxLength={3} value={cur} onChange={(e) => { setCur(e.target.value.toUpperCase()); setRate(null); setAmtB(null); }} /></div>
          <div className="field"><label htmlFor="of-curb">Currency of B</label><input id="of-curb" type="text" name="currency_b" maxLength={3} value={curB} onChange={(e) => { setCurB(e.target.value.toUpperCase()); setRate(null); setAmtB(null); }} /></div>
          {cur !== curB ? (
            <>
              <div className="field"><label htmlFor="of-rate">Rate: 1 {cur} = ? {curB} <span className={`pill ${rate !== null || amtB !== null ? "changes" : "published"}`}>{rate !== null || amtB !== null ? "edited" : "automatic"}</span></label>
                <input id="of-rate" type="number" name="rate" step="any" min="0" value={usedRate ? String(usedRate) : ""} placeholder={autoRate === null ? "no saved rate" : ""} onChange={(e) => { setRate(e.target.value); setAmtB(null); }} /></div>
              <div className="field"><label htmlFor="of-amtb">Amount on B ({curB})</label>
                <input id="of-amtb" type="number" name="amount_b" step="0.01" min="0" value={shownB} onChange={(e) => setAmtB(e.target.value)} />
                <input type="hidden" name="b_edited" value={amtB !== null ? "1" : "0"} /></div>
            </>
          ) : null}
          <div className="field"><label htmlFor="of-date">Date · التاريخ</label><input id="of-date" type="date" name="adj_date" defaultValue={today()} /></div>
          <div className="field"><label htmlFor="of-ref">Reference · مرجع</label><input id="of-ref" type="text" name="reference" maxLength={120} /></div>
          <div className="field full"><label htmlFor="of-desc">Description · البيان</label><input id="of-desc" type="text" name="description" maxLength={500} placeholder="e.g. Clinic X planning fees set off against its aligner invoice" /></div>
          <div className="full"><SubmitButton className="btn teal">Record offset · تسجيل التقاص</SubmitButton></div>
        </ActionForm>
      )}
    </>
  );
}
