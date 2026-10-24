"use client";

import { useMemo, useState } from "react";
import { CurrencySelect } from "./CurrencySelect";
import { ActionForm, SubmitButton } from "./ActionForm";
import type { ActionResult } from "./ActionForm";
import { invoiceTotals, LINE_ARCHES, PRICE_CATEGORIES, type InvoiceLine, type PriceItem } from "@/lib/invoices";

type Action = (prev: ActionResult, fd: FormData) => Promise<ActionResult>;
interface Header {
  currency: string; issue_date: string; due_date: string | null; bill_to: string | null;
  discount_amount: number; tax_label: string; tax_rate: number; notes: string | null;
}
type Row = InvoiceLine & { key: number };

let seq = 0;
const blank = (): Row => ({ key: ++seq, price_item_id: null, code: null, description: "", description_ar: null, arch: null, unit: null, qty: 1, unit_price: 0 });
const money = (n: number, cur: string) => {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: cur || "USD" }).format(n); } catch { return `${n.toFixed(2)} ${cur}`; }
};

export function InvoiceEditor({ action, header, lines, catalog, currencies, issued = false, revision = 0 }: { action: Action; header: Header; lines: InvoiceLine[]; catalog: PriceItem[]; currencies: string[]; issued?: boolean; revision?: number }) {
  const [rows, setRows] = useState<Row[]>(() => (lines.length ? lines.map((l) => ({ ...l, key: ++seq })) : [blank()]));
  const [currency, setCurrency] = useState(header.currency);
  const [discount, setDiscount] = useState(String(header.discount_amount ?? 0));
  const [taxRate, setTaxRate] = useState(String(header.tax_rate ?? 0));
  const [pick, setPick] = useState("");
  const totals = useMemo(() => invoiceTotals(rows, Number(discount), Number(taxRate)), [rows, discount, taxRate]);
  const groups = useMemo(() => {
    const g = new Map<string, PriceItem[]>();
    for (const p of catalog) g.set(p.category, [...(g.get(p.category) ?? []), p]);
    return [...g.entries()];
  }, [catalog]);
  const otherCurrency = catalog.some((p) => p.currency !== currency);

  const update = (key: number, patch: Partial<Row>) => setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const remove = (key: number) => setRows((r) => (r.length > 1 ? r.filter((x) => x.key !== key) : [blank()]));
  const move = (key: number, dir: -1 | 1) => setRows((r) => {
    const i = r.findIndex((x) => x.key === key); const j = i + dir;
    if (i < 0 || j < 0 || j >= r.length) return r;
    const c = [...r]; [c[i], c[j]] = [c[j], c[i]]; return c;
  });
  const addFromCatalog = (id: string) => {
    const p = catalog.find((x) => x.id === id);
    if (!p) return;
    const line: Row = {
      key: ++seq, price_item_id: p.id, code: p.code, description: p.name_en, description_ar: p.name_ar,
      arch: null, unit: p.unit_en, qty: 1, unit_price: Number(p.unit_price),
    };
    setRows((r) => (r.length === 1 && !r[0].description && !r[0].unit_price ? [line] : [...r, line]));
    setPick("");
  };
  const payload = JSON.stringify(rows.map(({ key: _k, ...l }) => l));

  return (
    <ActionForm action={action}>
      <input type="hidden" name="lines" value={payload} />
      <div className="form-grid">
        <div className="field"><label htmlFor="inv-currency">Currency · العملة</label>
          <CurrencySelect id="inv-currency" name="currency" options={currencies} value={currency} onChange={(e) => setCurrency(e.target.value)} required />
        </div>
        <div className="field"><label htmlFor="inv-issue">Invoice date · تاريخ الفاتورة</label><input id="inv-issue" name="issue_date" type="date" defaultValue={header.issue_date} /></div>
        <div className="field"><label htmlFor="inv-due">Due date · تاريخ الاستحقاق</label><input id="inv-due" name="due_date" type="date" defaultValue={header.due_date ?? ""} /></div>
        <div className="field full"><label htmlFor="inv-bill">Bill to · فاتورة إلى</label><textarea id="inv-bill" name="bill_to" rows={3} maxLength={600} defaultValue={header.bill_to ?? ""} dir="auto" /></div>
      </div>

      <div className="inv-add">
        <label htmlFor="inv-pick"><strong>Add item from the price list · إضافة صنف</strong></label>
        <select id="inv-pick" value={pick} onChange={(e) => addFromCatalog(e.target.value)}>
          <option value="">— choose an item —</option>
          {groups.map(([cat, items]) => (
            <optgroup key={cat} label={`${PRICE_CATEGORIES[cat]?.en ?? cat} · ${PRICE_CATEGORIES[cat]?.ar ?? ""}`}>
              {items.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name_en}{p.name_ar ? ` · ${p.name_ar}` : ""} ({money(Number(p.unit_price), p.currency)} / {p.unit_en})</option>)}
            </optgroup>
          ))}
        </select>
        <button type="button" className="btn secondary small" onClick={() => setRows((r) => [...r, blank()])}>+ Empty line</button>
      </div>
      {otherCurrency ? <p className="small muted">Note: some price-list items are in another currency. Prices are copied as numbers — check them against the invoice currency ({currency}).</p> : null}

      <div className="table-scroll">
        <table className="data inv-lines">
          <thead>
            <tr><th>#</th><th style={{ minWidth: 260 }}>Description · الوصف</th><th>Arch · الفك</th><th>Qty</th><th>Unit</th><th>Unit price</th><th className="num">Amount</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key}>
                <td className="muted">{i + 1}{r.code ? <div className="mono small nowrap">{r.code}</div> : null}</td>
                <td>
                  <input type="text" aria-label="Description (English)" value={r.description} maxLength={300} placeholder="Description" onChange={(e) => update(r.key, { description: e.target.value })} />
                  <input type="text" aria-label="Description (Arabic)" value={r.description_ar ?? ""} maxLength={300} placeholder="الوصف بالعربية (اختياري)" dir="rtl" style={{ marginTop: 4 }} onChange={(e) => update(r.key, { description_ar: e.target.value })} />
                </td>
                <td>
                  <select aria-label="Arch" style={{ minWidth: 120 }} value={r.arch ?? ""} onChange={(e) => update(r.key, { arch: e.target.value || null })}>
                    <option value="">—</option>
                    {Object.entries(LINE_ARCHES).map(([k, a]) => <option key={k} value={k}>{a.en} · {a.ar}</option>)}
                  </select>
                </td>
                <td><input aria-label="Quantity" type="number" min="0.01" step="any" value={r.qty} style={{ width: 70 }} onChange={(e) => update(r.key, { qty: Number(e.target.value) })} /></td>
                <td><input type="text" aria-label="Unit" value={r.unit ?? ""} maxLength={40} style={{ width: 80 }} onChange={(e) => update(r.key, { unit: e.target.value })} /></td>
                <td><input aria-label="Unit price" type="number" min="0" step="0.01" value={r.unit_price} style={{ width: 100 }} onChange={(e) => update(r.key, { unit_price: Number(e.target.value) })} /></td>
                <td className="num nowrap">{money((Number(r.qty) || 0) * (Number(r.unit_price) || 0), currency)}</td>
                <td className="line-actions">
                  <button type="button" className="icon-btn" title="Move up" onClick={() => move(r.key, -1)}>↑</button>
                  <button type="button" className="icon-btn" title="Move down" onClick={() => move(r.key, 1)}>↓</button>
                  <button type="button" className="icon-btn danger" title="Remove line" onClick={() => remove(r.key)}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="inv-bottom">
        <div className="form-grid" style={{ alignContent: "start" }}>
          <div className="field"><label htmlFor="inv-disc">Discount (amount) · خصم</label><input id="inv-disc" name="discount_amount" type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} /></div>
          <div className="field"><label htmlFor="inv-taxl">Tax name · اسم الضريبة</label><input id="inv-taxl" type="text" name="tax_label" defaultValue={header.tax_label} maxLength={30} /></div>
          <div className="field"><label htmlFor="inv-taxr">Tax rate % · نسبة الضريبة</label><input id="inv-taxr" name="tax_rate" type="number" min="0" max="100" step="0.01" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} /></div>
          <div className="field full"><label htmlFor="inv-notes">Notes / payment terms · ملاحظات وشروط الدفع</label><textarea id="inv-notes" name="notes" rows={3} maxLength={1500} defaultValue={header.notes ?? ""} dir="auto" /></div>
        </div>
        <dl className="inv-totals">
          <dt>Subtotal · المجموع</dt><dd>{money(totals.subtotal, currency)}</dd>
          {totals.discount ? <><dt>Discount · الخصم</dt><dd>− {money(totals.discount, currency)}</dd></> : null}
          {Number(taxRate) ? <><dt>Tax {taxRate}% · الضريبة</dt><dd>{money(totals.tax, currency)}</dd></> : null}
          <dt className="grand">Total · الإجمالي</dt><dd className="grand">{money(totals.total, currency)}</dd>
        </dl>
      </div>

      {issued ? (
        <div className="form-grid" style={{ marginTop: 16 }}>
          <div className="field full"><label htmlFor="inv-revnote">Reason for the change (shown on the case timeline) · سبب التعديل</label><input id="inv-revnote" type="text" name="revision_note" maxLength={300} placeholder="e.g. retainer quantity corrected" /></div>
        </div>
      ) : null}
      <div className="btn-row" style={{ marginTop: 16 }}>
        {issued ? (
          <>
            <SubmitButton name="intent" value="revise" className="btn teal" pendingText="Saving…">Save changes · حفظ التعديلات (rev. {revision + 1})</SubmitButton>
            <span className="small muted">The invoice keeps its number; the change is recorded as revision {revision + 1} and the agent sees the updated invoice.</span>
          </>
        ) : (
          <>
            <SubmitButton name="intent" value="save" className="btn secondary">Save draft · حفظ كمسودة</SubmitButton>
            <SubmitButton name="intent" value="issue" className="btn teal" pendingText="Issuing…">Issue invoice · إصدار الفاتورة</SubmitButton>
            <span className="small muted">Issuing gives the invoice its number and shows it to the agent. It can still be edited later (as a revision).</span>
          </>
        )}
      </div>
    </ActionForm>
  );
}
