import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { can, requireStaff } from "@/lib/auth";
import { createSessionClient } from "@/lib/admin";
import { accountsWithBalance, CASH_KINDS, teamPeople, voucherParties, type CashEntry } from "@/lib/finance";
import { saveCashAccount, transferCash } from "../../_actions/finance";
import { TransferForm } from "@/components/admin/TransferForm";
import { fmtRate, loadRates, ratesMap, refreshAutoRates, totalIn } from "@/lib/fx";
import { EntriesTable, NewEntryForm } from "../CashForms";

export const metadata = { title: "Cash boxes" };
const fmt = (n: number, c: string) => `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`;

export default async function CashPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams;
  await requireStaff(can.finance);
  const db = await createSessionClient();
  await refreshAutoRates(db, true); // best effort: keeps automatic rates fresh (max every 12 h)
  const q = (sp.q ?? "").replace(/[%_,()*]/g, " ").trim().slice(0, 60);
  const [accounts, { people, names }, parties, rates] = await Promise.all([
    accountsWithBalance(db),
    teamPeople(db),
    voucherParties(db),
    loadRates(db),
  ]);
  // Voucher search: number, party, description, reference, a lab / clinic or a team member by name
  let vq = db.from("cash_entries").select("*").order("created_at", { ascending: false }).limit(q ? 200 : 40);
  if (q) {
    const words = q.toLowerCase();
    const pIds = parties.partners.filter((p) => [p.name, p.contact, p.phone, p.city].some((x) => x?.toLowerCase().includes(words))).map((p) => p.id);
    const uIds = people.filter((p) => p.name.toLowerCase().includes(words)).map((p) => p.id);
    const ors = [`entry_no.ilike.%${q}%`, `party_name.ilike.%${q}%`, `description.ilike.%${q}%`, `reference.ilike.%${q}%`];
    if (pIds.length) ors.push(`partner_id.in.(${pIds.join(",")})`);
    if (uIds.length) ors.push(`party_user.in.(${uIds.join(",")})`);
    vq = vq.or(ors.join(","));
  }
  const { data: recent } = await vq;
  const fx = ratesMap(rates);
  const perUsd = Object.fromEntries(fx);
  const accMap = new Map(accounts.map((a) => [a.id, { name: a.name, currency: a.currency }]));
  const totals = new Map<string, number>();
  for (const a of accounts) if (a.active) totals.set(a.currency, (totals.get(a.currency) ?? 0) + a.balance);

  return (
    <>
      <div className="topbar">
        <div><h1>Cash boxes · الصناديق</h1><div className="sub">Receipts (سند قبض), payments & withdrawals (سند صرف) and transfers between boxes. Every voucher is numbered and printable.</div></div>
        <div className="btn-row"><Link className="btn secondary" href="/admin/finance/rates">💱 Exchange rates · أسعار الصرف{fx.get("EGP") ? ` (1 USD = ${fmtRate(fx.get("EGP")!)} EGP)` : ""}</Link><Link className="btn secondary" href="/admin/finance/people">Person accounts · حسابات الأشخاص</Link></div>
      </div>

      <div className="stats">
        {accounts.filter((a) => a.active).map((a) => (
          <Link key={a.id} href={`/admin/finance/cash/${a.id}`} className="stat stat-link">
            <div className="k">{a.name}<span className="small muted"> · {CASH_KINDS[a.kind]?.ar}</span></div>
            <div className="v" style={{ fontSize: "1.35rem", color: a.balance < 0 ? "#b42318" : undefined }}>{fmt(a.balance, a.currency)}</div>
            <div className="small muted">{a.custodian ? `Custodian: ${names.get(a.custodian) ?? "—"}` : "Open the statement →"}</div>
          </Link>
        ))}
        {totals.size ? <div className="stat"><div className="k">Total in all boxes</div><div className="v" style={{ fontSize: "1.05rem", paddingTop: 6 }}>{[...totals.entries()].map(([c, v]) => fmt(v, c)).join(" · ")}</div>
          {totals.size > 1 ? <div className="small muted">≈ {["USD", "EGP"].map((c) => { const t = totalIn(fx, totals, c); return t === null ? `— ${c}` : fmt(t, c); }).join(" · ")} at today&apos;s rates</div> : null}
        </div> : null}
      </div>

      <div className="case-cols">
        <section className="panel">
          <h2>Payment / withdrawal · سند صرف</h2>
          <p className="small muted" style={{ marginTop: -6 }}>Money that leaves a box: a person taking custody (عهدة), an owner withdrawal, salaries, lab, shipping, expenses… Choose the person so it appears in their account.</p>
          <NewEntryForm direction="out" accounts={accounts} people={people} parties={parties} />
        </section>
        <div>
          <section className="panel">
            <h2>Receipt · سند قبض</h2>
            <p className="small muted" style={{ marginTop: -6 }}>Money that enters a box (case payments are added automatically when you choose a box while recording the payment on the case).</p>
            <NewEntryForm direction="in" accounts={accounts} people={people} parties={parties} />
          </section>
          <section className="panel">
            <h2>Transfer between boxes · تحويل</h2>
            <TransferForm action={transferCash} boxes={accounts.filter((a) => a.active).map((a) => ({ id: a.id, name: a.name, currency: a.currency, balance: a.balance }))} perUsd={perUsd} />
          </section>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head"><h2>{q ? `Vouchers matching “${q}” · نتائج البحث (${(recent ?? []).length})` : "Latest vouchers · آخر السندات"}</h2><span className="small muted">Open a box above for its full statement.</span></div>
        <form className="voucher-search" method="get" role="search">
          <input type="search" name="q" defaultValue={q} placeholder="Search vouchers: lab, clinic, person, voucher no., description… · ابحث في السندات" aria-label="Search vouchers" />
          <button className="btn secondary" type="submit">Search · بحث</button>
          {q ? <Link className="btn secondary" href="/admin/finance/cash">Clear</Link> : null}
        </form>
        <EntriesTable entries={(recent ?? []) as CashEntry[]} accounts={accMap} people={people} parties={parties} names={names} />
      </section>

      <section className="panel">
        <h2>Manage boxes · إدارة الصناديق</h2>
        <div className="table-scroll">
          <table className="data">
            <thead><tr><th>Box</th><th>Type</th><th>Currency</th><th className="num">Opening</th><th className="num">Balance</th><th /></tr></thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={`${a.id}-${a.name}-${a.active}`} style={a.active ? undefined : { opacity: 0.5 }}>
                  <td><Link href={`/admin/finance/cash/${a.id}`}>{a.name}</Link>{a.active ? null : <span className="pill closed"> closed</span>}</td>
                  <td className="small">{CASH_KINDS[a.kind]?.en}</td>
                  <td className="mono">{a.currency}</td>
                  <td className="num">{fmt(Number(a.opening_balance), a.currency)}</td>
                  <td className="num"><strong>{fmt(a.balance, a.currency)}</strong></td>
                  <td>
                    <details className="inline-details">
                      <summary className="btn secondary small">Edit</summary>
                      <ActionForm action={saveCashAccount.bind(null, a.id)} className="form-grid inline-form wide">
                        <div className="field"><label htmlFor={`n-${a.id}`}>Name</label><input id={`n-${a.id}`} type="text" name="name" defaultValue={a.name} maxLength={80} /></div>
                        <div className="field"><label htmlFor={`k-${a.id}`}>Type</label><select id={`k-${a.id}`} name="kind" defaultValue={a.kind}>{Object.entries(CASH_KINDS).map(([k, v]) => <option key={k} value={k}>{v.en} · {v.ar}</option>)}</select></div>
                        <div className="field"><label htmlFor={`c-${a.id}`}>Currency</label><input id={`c-${a.id}`} type="text" name="currency" defaultValue={a.currency} maxLength={3} /></div>
                        <div className="field"><label htmlFor={`cu-${a.id}`}>Custodian · أمين الصندوق</label><select id={`cu-${a.id}`} name="custodian" defaultValue={a.custodian ?? ""}><option value="">—</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
                        <div className="field"><label htmlFor={`o-${a.id}`}>Opening balance</label><input id={`o-${a.id}`} type="number" name="opening_balance" min="0" step="0.01" defaultValue={Number(a.opening_balance)} /></div>
                        <div className="field"><label htmlFor={`s-${a.id}`}>Order</label><input id={`s-${a.id}`} type="number" name="sort_order" defaultValue={a.sort_order} /></div>
                        <div className="field full"><label htmlFor={`no-${a.id}`}>Notes</label><input id={`no-${a.id}`} type="text" name="notes" defaultValue={a.notes ?? ""} maxLength={500} /></div>
                        <div className="field full"><label className="check"><input type="checkbox" name="active" defaultChecked={a.active} /> Open (can receive and pay)</label></div>
                        <div className="full"><SubmitButton className="btn small">Save box</SubmitButton></div>
                      </ActionForm>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <details style={{ marginTop: 12 }}>
          <summary><strong>+ Add a cash box · إضافة صندوق</strong></summary>
          <ActionForm action={saveCashAccount.bind(null, null)} className="form-grid" resetOnSuccess>
            <div className="field"><label htmlFor="na-name">Name *</label><input id="na-name" type="text" name="name" maxLength={80} required placeholder="e.g. Petty cash — Cairo office" /></div>
            <div className="field"><label htmlFor="na-kind">Type</label><select id="na-kind" name="kind">{Object.entries(CASH_KINDS).map(([k, v]) => <option key={k} value={k}>{v.en} · {v.ar}</option>)}</select></div>
            <div className="field"><label htmlFor="na-cur">Currency</label><input id="na-cur" type="text" name="currency" defaultValue="EGP" maxLength={3} /></div>
            <div className="field"><label htmlFor="na-open">Opening balance</label><input id="na-open" type="number" name="opening_balance" min="0" step="0.01" defaultValue={0} /></div>
            <div className="field"><label htmlFor="na-cu">Custodian</label><select id="na-cu" name="custodian"><option value="">—</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div className="field"><label htmlFor="na-notes">Notes</label><input id="na-notes" type="text" name="notes" maxLength={500} /></div>
            <div className="full"><SubmitButton className="btn teal">Add box</SubmitButton></div>
          </ActionForm>
        </details>
      </section>
    </>
  );
}
