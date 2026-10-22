import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { can, requireStaff } from "@/lib/auth";
import { createSessionClient } from "@/lib/admin";
import { fmtMoney } from "@/lib/cases";
import { PRICE_CATEGORIES, type PriceItem } from "@/lib/invoices";
import { saveBillingSettings, savePriceItem } from "../_actions/invoices";

export const metadata = { title: "Price list & billing" };

function ItemFields({ p }: { p?: PriceItem }) {
  const k = p?.id ?? "new";
  return (
    <>
      <div className="field"><label htmlFor={`code-${k}`}>Code *</label><input id={`code-${k}`} type="text" name="code" defaultValue={p?.code ?? ""} maxLength={24} className="mono" required placeholder="ALN-FULL" /></div>
      <div className="field"><label htmlFor={`cat-${k}`}>Category</label>
        <select id={`cat-${k}`} name="category" defaultValue={p?.category ?? "aligner"}>
          {Object.entries(PRICE_CATEGORIES).map(([v, c]) => <option key={v} value={v}>{c.en} · {c.ar}</option>)}
        </select>
      </div>
      <div className="field"><label htmlFor={`en-${k}`}>Name (English) *</label><input id={`en-${k}`} type="text" name="name_en" defaultValue={p?.name_en ?? ""} maxLength={160} required /></div>
      <div className="field"><label htmlFor={`ar-${k}`}>الاسم بالعربية</label><input id={`ar-${k}`} type="text" name="name_ar" defaultValue={p?.name_ar ?? ""} maxLength={160} dir="rtl" /></div>
      <div className="field"><label htmlFor={`ue-${k}`}>Unit</label><input id={`ue-${k}`} type="text" name="unit_en" defaultValue={p?.unit_en ?? "piece"} maxLength={40} placeholder="arch, aligner, set, case…" /></div>
      <div className="field"><label htmlFor={`ua-${k}`}>الوحدة</label><input id={`ua-${k}`} type="text" name="unit_ar" defaultValue={p?.unit_ar ?? ""} maxLength={40} dir="rtl" placeholder="فك، أليانر، طقم…" /></div>
      <div className="field"><label htmlFor={`pr-${k}`}>Unit price *</label><input id={`pr-${k}`} type="number" name="unit_price" min="0" step="0.01" defaultValue={p ? Number(p.unit_price) : ""} required /></div>
      <div className="field"><label htmlFor={`cu-${k}`}>Currency</label><input id={`cu-${k}`} type="text" name="currency" defaultValue={p?.currency ?? "USD"} maxLength={3} /></div>
      <div className="field"><label htmlFor={`so-${k}`}>Order</label><input id={`so-${k}`} type="number" name="sort_order" defaultValue={p?.sort_order ?? 0} /></div>
      <div className="field"><label>&nbsp;</label><label className="check"><input type="checkbox" name="active" defaultChecked={p ? p.active : true} /> Active (shown when invoicing)</label></div>
    </>
  );
}

export default async function PriceList() {
  await requireStaff(can.finance);
  const db = await createSessionClient();
  const [{ data: items, error }, { data: billing }] = await Promise.all([
    db.from("case_price_items").select("*").order("sort_order").order("code"),
    db.from("case_billing_settings").select("*").eq("id", 1).maybeSingle(),
  ]);
  const list = (items ?? []) as PriceItem[];
  const unpriced = list.filter((p) => p.active && Number(p.unit_price) === 0).length;
  return (
    <>
      <div className="topbar"><div><h1>Price list & billing · قائمة الأسعار والفوترة</h1><div className="sub">Items you invoice per case — aligners, Snap-On, retainers, planning, shipping… Prices are copied into each invoice and can be adjusted there.</div></div></div>
      {error ? <div className="flash err">{error.message}</div> : null}
      {unpriced ? <div className="flash warn">{unpriced} active item(s) still have price 0 — open them below and set your prices.</div> : null}

      <section className="panel">
        <h2>Items · الأصناف</h2>
        <div className="table-scroll">
          <table className="data">
            <thead><tr><th>Code</th><th>Item</th><th>Category</th><th>Unit</th><th className="num">Price</th><th /></tr></thead>
            <tbody>
              {list.map((p) => (
                <tr key={`${p.id}-${(p as PriceItem & { updated_at?: string }).updated_at ?? ""}`} style={p.active ? undefined : { opacity: 0.5 }}>
                  <td className="mono">{p.code}</td>
                  <td>{p.name_en}{p.name_ar ? <div className="small muted" dir="rtl">{p.name_ar}</div> : null}</td>
                  <td className="small">{PRICE_CATEGORIES[p.category]?.en}</td>
                  <td className="small">{p.unit_en}{p.unit_ar ? ` · ${p.unit_ar}` : ""}</td>
                  <td className="num">{Number(p.unit_price) ? fmtMoney(p.unit_price, p.currency) : <span className="pill changes">set price</span>}</td>
                  <td>
                    <details className="inline-details">
                      <summary className="btn secondary small">Edit</summary>
                      <ActionForm action={savePriceItem.bind(null, p.id)} className="form-grid inline-form wide">
                        <ItemFields p={p} />
                        <div className="full"><SubmitButton className="btn small">Save item</SubmitButton></div>
                      </ActionForm>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <details style={{ marginTop: 14 }}>
          <summary><strong>+ Add an item · إضافة صنف</strong></summary>
          <ActionForm action={savePriceItem.bind(null, null)} className="form-grid" resetOnSuccess>
            <ItemFields />
            <div className="full"><SubmitButton className="btn teal">Add item</SubmitButton></div>
          </ActionForm>
        </details>
      </section>

      <section className="panel">
        <h2>Billing details printed on invoices · بيانات الفوترة</h2>
        <ActionForm action={saveBillingSettings} className="form-grid">
          <div className="field"><label htmlFor="b-cur">Default currency</label><input id="b-cur" type="text" name="default_currency" defaultValue={billing?.default_currency ?? "USD"} maxLength={3} /></div>
          <div className="field"><label htmlFor="b-due">Payment due after (days)</label><input id="b-due" type="number" name="due_days" min="0" max="365" defaultValue={billing?.due_days ?? 14} /></div>
          <div className="field"><label htmlFor="b-tl">Tax name</label><input id="b-tl" type="text" name="tax_label" defaultValue={billing?.tax_label ?? "VAT"} maxLength={30} /></div>
          <div className="field"><label htmlFor="b-tr">Default tax rate %</label><input id="b-tr" type="number" name="tax_rate" min="0" max="100" step="0.01" defaultValue={billing ? Number(billing.tax_rate) : 0} /></div>
          <div className="field"><label htmlFor="b-tn">Tax / commercial registration no.</label><input id="b-tn" type="text" name="tax_number" defaultValue={billing?.tax_number ?? ""} maxLength={60} /></div>
          <div className="field full"><label htmlFor="b-bank">Bank / payment details · بيانات الحساب البنكي</label><textarea id="b-bank" name="bank_details" rows={4} maxLength={1000} defaultValue={billing?.bank_details ?? ""} dir="auto" placeholder={"Bank name\nAccount name\nIBAN / SWIFT\nInstaPay / Vodafone Cash…"} /></div>
          <div className="field full"><label htmlFor="b-terms">Default terms (pre-filled in new invoices)</label><textarea id="b-terms" name="terms" rows={3} maxLength={1000} defaultValue={billing?.terms ?? ""} dir="auto" /></div>
          <div className="full"><SubmitButton>Save billing details</SubmitButton></div>
        </ActionForm>
      </section>
    </>
  );
}
