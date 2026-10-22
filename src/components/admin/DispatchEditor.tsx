"use client";

import { useMemo, useState } from "react";
import { ActionForm, SubmitButton } from "./ActionForm";
import type { ActionResult } from "./ActionForm";
import { LINE_ARCHES, PRICE_CATEGORIES } from "@/lib/invoices";
import type { CatalogItem, DispatchLine } from "@/lib/dispatch";

type Action = (prev: ActionResult, fd: FormData) => Promise<ActionResult>;
type Row = DispatchLine & { key: number };
let seq = 0;
const blank = (): Row => ({ key: ++seq, price_item_id: null, code: null, description: "", description_ar: null, arch: null, unit: null, qty: 1 });

/** Case manager: services and quantities for the case — no prices (finance prices them). */
export function DispatchEditor({ action, lines, notes, catalog }: { action: Action; lines: DispatchLine[]; notes: string | null; catalog: CatalogItem[] }) {
  const [rows, setRows] = useState<Row[]>(() => (lines.length ? lines.map((l) => ({ ...l, key: ++seq })) : []));
  const [pick, setPick] = useState("");
  const groups = useMemo(() => {
    const g = new Map<string, CatalogItem[]>();
    for (const p of catalog) g.set(p.category, [...(g.get(p.category) ?? []), p]);
    return [...g.entries()];
  }, [catalog]);
  const update = (key: number, patch: Partial<Row>) => setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const add = (id: string) => {
    const p = catalog.find((x) => x.id === id);
    if (!p) return;
    setRows((r) => [...r, { key: ++seq, price_item_id: p.id, code: p.code, description: p.name_en, description_ar: p.name_ar, arch: null, unit: p.unit_en, qty: 1 }]);
    setPick("");
  };
  const total = rows.reduce((a, r) => a + (Number(r.qty) || 0), 0);
  return (
    <ActionForm action={action}>
      <input type="hidden" name="lines" value={JSON.stringify(rows.map(({ key: _k, ...l }) => l))} />
      <div className="inv-add">
        <label htmlFor="do-pick"><strong>Add a service · إضافة خدمة</strong></label>
        <select id="do-pick" value={pick} onChange={(e) => add(e.target.value)}>
          <option value="">— choose a service —</option>
          {groups.map(([cat, items]) => (
            <optgroup key={cat} label={`${PRICE_CATEGORIES[cat]?.en ?? cat} · ${PRICE_CATEGORIES[cat]?.ar ?? ""}`}>
              {items.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name_en}{p.name_ar ? ` · ${p.name_ar}` : ""} ({p.unit_en})</option>)}
            </optgroup>
          ))}
        </select>
        <button type="button" className="btn secondary small" onClick={() => setRows((r) => [...r, blank()])}>+ Other service</button>
      </div>
      <div className="table-scroll">
        <table className="data inv-lines">
          <thead><tr><th>#</th><th style={{ minWidth: 280 }}>Service · الخدمة</th><th>Arch · الفك</th><th>Quantity · الكمية</th><th>Unit</th><th /></tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={6} className="empty">Add the services for this case — aligners, Snap-On, retainers, attachment template…</td></tr> : null}
            {rows.map((r, i) => (
              <tr key={r.key}>
                <td className="muted">{i + 1}{r.code ? <div className="mono small nowrap">{r.code}</div> : null}</td>
                <td>
                  <input type="text" aria-label="Service" value={r.description} maxLength={300} onChange={(e) => update(r.key, { description: e.target.value })} />
                  <input type="text" aria-label="Service (Arabic)" value={r.description_ar ?? ""} maxLength={300} dir="rtl" placeholder="بالعربية (اختياري)" style={{ marginTop: 4 }} onChange={(e) => update(r.key, { description_ar: e.target.value })} />
                </td>
                <td><select aria-label="Arch" style={{ minWidth: 120 }} value={r.arch ?? ""} onChange={(e) => update(r.key, { arch: e.target.value || null })}><option value="">—</option>{Object.entries(LINE_ARCHES).map(([k, a]) => <option key={k} value={k}>{a.en} · {a.ar}</option>)}</select></td>
                <td><input type="number" aria-label="Quantity" min="0.01" step="any" value={r.qty} style={{ width: 90 }} onChange={(e) => update(r.key, { qty: Number(e.target.value) })} /></td>
                <td><input type="text" aria-label="Unit" value={r.unit ?? ""} maxLength={40} style={{ width: 90 }} onChange={(e) => update(r.key, { unit: e.target.value })} /></td>
                <td className="line-actions"><button type="button" className="icon-btn danger" title="Remove" onClick={() => setRows((x) => x.filter((y) => y.key !== r.key))}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">{rows.length} line(s) · total quantity {total}</p>
      <div className="field"><label htmlFor="do-notes">Notes for finance / production · ملاحظات</label><textarea id="do-notes" name="notes" rows={2} maxLength={1500} defaultValue={notes ?? ""} dir="auto" /></div>
      <div className="btn-row" style={{ marginTop: 12 }}>
        <SubmitButton name="intent" value="save" className="btn secondary">Save draft · حفظ</SubmitButton>
        <SubmitButton name="intent" value="send" className="btn teal" pendingText="Sending…">Send to finance · إرسال للمالية</SubmitButton>
        <span className="small muted">Finance adds the prices and issues the invoice. You will see when it is invoiced.</span>
      </div>
    </ActionForm>
  );
}
