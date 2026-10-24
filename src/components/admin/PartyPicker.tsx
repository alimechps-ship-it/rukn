"use client";

import { useMemo, useRef, useState } from "react";

export type PickerPartner = { id: string; name: string; kind: string; contact: string | null; phone: string | null; city: string | null; currency: string; active: boolean };
export type PickerPerson = { id: string; name: string };
export type PickerAgent = { id: string; name: string; sub: string };
export type PickerBill = { id: string; bill_no: string; partner_id: string; due: number; currency: string };

type Opt = { key: string; type: "partner" | "person" | "agent"; id: string; label: string; sub: string; badge: string; hay: string };

const KIND: Record<string, { en: string; ar: string }> = {
  lab: { en: "Lab", ar: "معمل" },
  planner: { en: "Clinic / planner", ar: "عيادة / مخطط" },
};
const norm = (s: string) => s.toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/\s+/g, " ").trim();

/**
 * Searchable party of a cash voucher: a lab, a clinic / planner, a team member or agent,
 * or a free-typed name. Posts party_user / partner_id / party_name (+ bill_id for a partner bill).
 */
export function PartyPicker({ idp, direction, partners, people, agents = [], bills = [], initial }: {
  idp: string; direction: "in" | "out"; partners: PickerPartner[]; people: PickerPerson[]; agents?: PickerAgent[]; bills?: PickerBill[];
  initial?: { partner_id?: string | null; party_user?: string | null; party_name?: string | null; agent_id?: string | null };
}) {
  const options = useMemo<Opt[]>(() => [
    ...partners.filter((p) => p.active || p.id === initial?.partner_id).map((p) => ({
      key: `p-${p.id}`, type: "partner" as const, id: p.id, label: p.name,
      sub: [p.contact, p.phone, p.city].filter(Boolean).join(" · "), badge: `${KIND[p.kind]?.en ?? p.kind} · ${KIND[p.kind]?.ar ?? ""}`,
      hay: norm([p.name, p.contact, p.phone, p.city, KIND[p.kind]?.en, KIND[p.kind]?.ar, p.kind === "planner" ? "clinic doctor عياده دكتور طبيب" : "lab معمل"].filter(Boolean).join(" ")),
    })),
    ...agents.map((a) => ({ key: `a-${a.id}`, type: "agent" as const, id: a.id, label: a.name, sub: a.sub, badge: "Agent · مندوب", hay: norm(`${a.name} ${a.sub} agent مندوب`) })),
    ...people.filter((p) => !agents.some((a) => a.id === p.id)).map((p) => ({ key: `u-${p.id}`, type: "person" as const, id: p.id, label: p.name, sub: "", badge: "Team · فريق", hay: norm(p.name) })),
  ], [partners, people, agents, initial?.partner_id]);

  const start = initial?.agent_id ? options.find((o) => o.type === "agent" && o.id === initial.agent_id)
    : initial?.partner_id ? options.find((o) => o.type === "partner" && o.id === initial.partner_id)
    : initial?.party_user ? options.find((o) => o.type === "person" && o.id === initial.party_user) : undefined;
  const [picked, setPicked] = useState<Opt | undefined>(start);
  const [text, setText] = useState(start ? "" : initial?.party_name ?? "");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [bill, setBill] = useState("");
  const box = useRef<HTMLDivElement>(null);

  const q = norm(text);
  const list = useMemo(() => (q ? options.filter((o) => q.split(" ").every((w) => o.hay.includes(w))) : options).slice(0, 30), [q, options]);
  const choose = (o: Opt) => { setPicked(o); setText(""); setOpen(false); setBill(""); };
  const partnerBills = picked?.type === "partner" ? bills.filter((b) => b.partner_id === picked.id && b.due > 0) : [];

  return (
    <div className="field full party-picker" ref={box}>
      <label htmlFor={`${idp}-party`}>Paid to / received from · الجهة (مندوب، معمل، عيادة، شخص) — search · ابحث</label>
      <input type="hidden" name="partner_id" value={picked?.type === "partner" ? picked.id : ""} />
      <input type="hidden" name="party_user" value={picked?.type === "person" ? picked.id : ""} />
      <input type="hidden" name="agent_id" value={picked?.type === "agent" ? picked.id : ""} />
      <input type="hidden" name="party_name" value={picked ? "" : text} />
      {picked ? (
        <div className="picked">
          <span className={`pill ${picked.type === "partner" ? "qualified" : "new"}`}>{picked.badge}</span>
          <strong>{picked.label}</strong>{picked.sub ? <span className="small muted"> · {picked.sub}</span> : null}
          <button type="button" className="icon-btn" title="Change" aria-label="Change" onClick={() => { setPicked(undefined); setBill(""); setTimeout(() => box.current?.querySelector<HTMLInputElement>("input[type=text]")?.focus(), 0); }}>✕</button>
        </div>
      ) : (
        <div style={{ position: "relative" }}>
          <input id={`${idp}-party`} type="text" autoComplete="off" value={text} maxLength={120} role="combobox" aria-expanded={open} aria-controls={`${idp}-party-list`}
            placeholder="Type a lab, clinic, doctor, phone or person… · اكتب اسم المعمل أو العيادة أو الشخص"
            onChange={(e) => { setText(e.target.value); setOpen(true); setHi(0); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (!open || !list.length) return;
              if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, list.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
              else if (e.key === "Enter") { e.preventDefault(); choose(list[hi]); }
              else if (e.key === "Escape") setOpen(false);
            }} />
          {open && list.length ? (
            <ul className="picker-list" id={`${idp}-party-list`} role="listbox">
              {list.map((o, i) => (
                <li key={o.key} role="option" aria-selected={i === hi} className={i === hi ? "hi" : undefined} onMouseDown={(e) => { e.preventDefault(); choose(o); }} onMouseEnter={() => setHi(i)}>
                  <span className={`pill ${o.type === "partner" ? "qualified" : "new"}`}>{o.badge}</span> <strong>{o.label}</strong>{o.sub ? <span className="small muted"> · {o.sub}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {text && !list.length ? <span className="small muted">Not found — the typed name is saved as written.</span> : null}
        </div>
      )}
      {picked?.type === "agent" ? (
        <div className="small" style={{ marginTop: 6 }}>{direction === "out"
          ? <>Recorded as <strong>paid to the agent {picked.label}</strong>: it appears in his account statement as a debit (مدين).</>
          : <>Recorded as <strong>received from the agent {picked.label}</strong>: it appears in his account statement as a credit (دائن) and reduces what he owes.</>}</div>
      ) : null}
      {picked?.type === "partner" ? (
        direction === "out" ? (
          <div className="small" style={{ marginTop: 6 }}>
            Recorded as a <strong>payment to {picked.label}</strong> (PP-): it reduces what RUKN owes them and appears in their statement.
            {partnerBills.length ? (
              <div style={{ marginTop: 6 }}><label htmlFor={`${idp}-bill`}>For bill · عن فاتورة</label>{" "}
                <select id={`${idp}-bill`} name="bill_id" value={bill} onChange={(e) => {
                  setBill(e.target.value);
                  const b = partnerBills.find((x) => x.id === e.target.value);
                  const amt = box.current?.closest("form")?.querySelector<HTMLInputElement>("input[name=amount]");
                  if (b && amt) { amt.value = String(b.due); }
                }}>
                  <option value="">— advance / not for a bill —</option>
                  {partnerBills.map((b) => <option key={b.id} value={b.id}>{b.bill_no} · due {b.due.toLocaleString("en-US", { minimumFractionDigits: 2 })} {b.currency}</option>)}
                </select>
              </div>
            ) : null}
          </div>
        ) : <div className="small" style={{ marginTop: 6 }}>Recorded as <strong>money returned by {picked.label}</strong> (مرتجع): it appears in their statement.</div>
      ) : null}
    </div>
  );
}
