import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { JournalForm, type JAccount, type JDoc } from "@/components/admin/JournalForm";
import { can, requireStaff } from "@/lib/auth";
import { createSessionClient } from "@/lib/admin";
import { peopleWithRole, profileMap } from "@/lib/case-data";
import { fmtDay, fmtMoney } from "@/lib/cases";
import { loadReceivables, voucherParties } from "@/lib/finance";
import { loadRates } from "@/lib/fx";
import { accountNames, LEDGER_KINDS, TEMPLATES, type JournalEntry, type LedgerAccount } from "@/lib/journal";
import { createJournal, saveLedgerAccount, voidJournal } from "../../_actions/journal";

export const metadata = { title: "Journal entries" };
const UUID = /^[0-9a-f-]{36}$/i;
const add = (m: Map<string, number>, k: string, v: number) => m.set(k, Math.round(((m.get(k) ?? 0) + v) * 100) / 100);
const mm = (m: Map<string, number>) => (m.size ? [...m.entries()].filter(([, v]) => v !== 0).map(([c, v]) => `${v < 0 ? "Cr " : "Dr "}${fmtMoney(Math.abs(v), c)}`).join(" · ") || "—" : "—");

export default async function JournalPage({ searchParams }: { searchParams: Promise<{ q?: string; account?: string }> }) {
  const sp = await searchParams;
  await requireStaff(can.finance);
  const db = await createSessionClient();
  const [agents, parties, rec, rates, { data: ledgerRows }, { data: rows }] = await Promise.all([
    peopleWithRole(db, ["agent"]),
    voucherParties(db),
    loadReceivables(db, {}),
    loadRates(db),
    db.from("ledger_accounts").select("*").order("code"),
    db.from("journal_entries").select("*").order("created_at", { ascending: false }).limit(1000),
  ]);
  const ledgers = (ledgerRows ?? []) as LedgerAccount[];
  const accounts: JAccount[] = [
    ...ledgers.filter((l) => l.active).map((l) => ({ key: `ledger:${l.id}`, type: "ledger" as const, id: l.id, name: `${l.name_en}${l.name_ar ? ` · ${l.name_ar}` : ""}`, sub: LEDGER_KINDS[l.kind]?.ar ?? "", badge: "Account · حساب", currency: null, code: l.code })),
    ...agents.map((a) => ({ key: `agent:${a.id}`, type: "agent" as const, id: a.id, name: a.name, sub: a.label.replace(a.name, "").replace(/^\s*·\s*/, ""), badge: "Agent · مندوب", currency: null })),
    ...parties.partners.filter((p) => p.active).map((p) => ({ key: `partner:${p.id}`, type: "partner" as const, id: p.id, name: p.name, sub: [p.contact, p.phone, p.city].filter(Boolean).join(" · "), badge: p.kind === "lab" ? "Lab · معمل" : "Clinic · عيادة", currency: p.currency })),
  ];
  const docs: JDoc[] = [
    ...rec.rows.map((r) => ({ id: r.invoice_id, key: `agent:${r.agent_id}`, currency: r.currency, label: `${r.invoice_no} · ${r.code} · due ${fmtMoney(r.balance, r.currency)}` })),
    ...parties.bills.map((b) => ({ id: b.id, key: `partner:${b.partner_id}`, currency: b.currency, label: `${b.bill_no} · due ${fmtMoney(b.due, b.currency)}` })),
  ];

  const all = (rows ?? []) as JournalEntry[];
  const names = await accountNames(db, all);
  const people = await profileMap(db, all.map((e) => e.created_by));
  // account filter → that account's movements with running balance (Dr + / Cr −)
  const [fType, fId] = (sp.account ?? "").split(":");
  const filter = ["agent", "partner", "ledger"].includes(fType) && UUID.test(fId ?? "") ? { type: fType, id: fId } : null;
  const touches = (e: JournalEntry, s: "dr" | "cr") => !!filter && e[`${s}_type`] === filter.type && (e[`${s}_agent_id`] ?? e[`${s}_partner_id`] ?? e[`${s}_ledger_id`]) === filter.id;
  const q = (sp.q ?? "").trim().toLowerCase();
  let list = all.filter((e) => (!filter || touches(e, "dr") || touches(e, "cr"))
    && (!q || [e.entry_no, e.description, e.reference, names.side(e, "dr").en, names.side(e, "cr").en, names.side(e, "dr").ar, names.side(e, "cr").ar].some((v) => v?.toLowerCase().includes(q))));
  const running = new Map<string, Map<string, number>>();
  if (filter) {
    list = [...list].sort((a, b) => (a.entry_date !== b.entry_date ? (a.entry_date < b.entry_date ? -1 : 1) : a.created_at < b.created_at ? -1 : 1));
    const bal = new Map<string, number>();
    for (const e of list) {
      if (e.voided) continue;
      if (touches(e, "dr")) add(bal, e.dr_currency, Number(e.dr_amount));
      if (touches(e, "cr")) add(bal, e.cr_currency, -Number(e.cr_amount));
      running.set(e.id, new Map(bal));
    }
  }
  const filterName = filter ? accounts.find((a) => a.key === `${filter.type}:${filter.id}`) : undefined;
  // ledger balances
  const lb = new Map<string, Map<string, number>>();
  for (const e of all) if (!e.voided) {
    if (e.dr_ledger_id) { if (!lb.has(e.dr_ledger_id)) lb.set(e.dr_ledger_id, new Map()); add(lb.get(e.dr_ledger_id)!, e.dr_currency, Number(e.dr_amount)); }
    if (e.cr_ledger_id) { if (!lb.has(e.cr_ledger_id)) lb.set(e.cr_ledger_id, new Map()); add(lb.get(e.cr_ledger_id)!, e.cr_currency, -Number(e.cr_amount)); }
  }
  const preset = sp.account && UUID.test(fId ?? "") ? sp.account : undefined;

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Journal entries · القيود</h1>
          <div className="sub">Simple entries (قيد بسيط): one debit account and one credit account — agents, labs / clinics and general accounts (discount allowed / earned, other services, currency differences…). No cash moves; cash goes through the cash-box vouchers. When the two sides are in different currencies the exchange rate is applied (automatic or edited).</div>
        </div>
      </div>

      <section className="panel">
        <h2>New entry · قيد جديد</h2>
        <JournalForm action={createJournal} accounts={accounts} docs={docs} templates={TEMPLATES} perUsd={Object.fromEntries(rates.map((r) => [r.currency, r.per_usd]))} preset={preset} />
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{filterName ? `Account movements · حركة حساب: ${filterName.code ? `${filterName.code} ` : ""}${filterName.name}` : "Journal · سجل القيود"} ({list.length})</h2>
          {filter ? <Link className="btn secondary small" href="/admin/finance/journal">All entries</Link> : null}
        </div>
        <form className="voucher-search" method="get" role="search">
          {filter ? <input type="hidden" name="account" value={sp.account} /> : null}
          <input type="search" name="q" defaultValue={sp.q ?? ""} placeholder="Search: JV- number, account, agent, lab, description… · ابحث" aria-label="Search entries" />
          <button className="btn secondary" type="submit">Search · بحث</button>
          {sp.q ? <Link className="btn secondary" href={filter ? `/admin/finance/journal?account=${sp.account}` : "/admin/finance/journal"}>Clear</Link> : null}
        </form>
        {list.length ? (
          <div className="table-scroll">
            <table className="data">
              <thead><tr><th>No.</th><th>Date</th><th>Debit · مدين</th><th>Credit · دائن</th><th>Description</th>{filter ? <th className="num">Balance · الرصيد</th> : null}<th /></tr></thead>
              <tbody>
                {list.map((e) => {
                  const d = names.side(e, "dr"); const c = names.side(e, "cr");
                  return (
                    <tr key={e.id} style={e.voided ? { opacity: 0.5 } : undefined}>
                      <td className="mono nowrap">{e.entry_no}{e.voided ? <div><span className="pill closed">void</span></div> : null}</td>
                      <td className="small nowrap">{fmtDay(e.entry_date)}</td>
                      <td className="small"><Link href={`/admin/finance/journal?account=${e.dr_type}:${e.dr_agent_id ?? e.dr_partner_id ?? e.dr_ledger_id}`}><strong>{d.en}</strong></Link>{d.ar ? <div className="muted">{d.ar}</div> : null}<div className="nowrap" style={{ color: "#b42318" }}>{fmtMoney(e.dr_amount, e.dr_currency)}</div></td>
                      <td className="small"><Link href={`/admin/finance/journal?account=${e.cr_type}:${e.cr_agent_id ?? e.cr_partner_id ?? e.cr_ledger_id}`}><strong>{c.en}</strong></Link>{c.ar ? <div className="muted">{c.ar}</div> : null}<div className="nowrap" style={{ color: "#067647" }}>{fmtMoney(e.cr_amount, e.cr_currency)}</div></td>
                      <td className="small">{e.description}{e.fx_rate ? <div className="muted">1 {e.dr_currency} = {Number(e.fx_rate)} {e.cr_currency} ({e.fx_source === "auto" ? "auto" : "manual"})</div> : null}{e.reference ? <div className="muted">Ref. {e.reference}</div> : null}{e.voided && e.void_reason ? <div className="muted">Void: {e.void_reason}</div> : null}<div className="muted">{people.get(e.created_by ?? "")?.name ?? ""}</div></td>
                      {filter ? <td className="num nowrap small"><strong>{running.has(e.id) ? mm(running.get(e.id)!) : ""}</strong></td> : null}
                      <td className="nowrap">
                        <a className="btn secondary small" href={`/admin/print/journal/${e.id}`} target="_blank" rel="noopener" title="Print">🖨</a>{" "}
                        {!e.voided ? (
                          <details className="inline-details" style={{ display: "inline-block" }}>
                            <summary className="btn danger small">Void</summary>
                            <ActionForm action={voidJournal} className="inline-form">
                              <input type="hidden" name="id" value={e.id} />
                              <input type="text" name="reason" placeholder="Reason for voiding" aria-label="Reason" maxLength={300} required />
                              <SubmitButton className="btn danger small">Void</SubmitButton>
                            </ActionForm>
                          </details>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="small muted">No entries{q || filter ? " match" : " yet"}.</p>}
      </section>

      <section className="panel" id="accounts">
        <h2>General accounts · دليل الحسابات العامة</h2>
        <p className="small muted" style={{ marginTop: -6 }}>Agents and labs / clinics are accounts automatically. Here are the other accounts used in entries. Balance: Dr = debit balance, Cr = credit balance.</p>
        <div className="table-scroll">
          <table className="data">
            <thead><tr><th>Code</th><th>Account</th><th>Type</th><th className="num">Balance</th><th /></tr></thead>
            <tbody>
              {ledgers.map((l) => (
                <tr key={l.id} style={l.active ? undefined : { opacity: 0.5 }}>
                  <td className="mono">{l.code}</td>
                  <td><Link href={`/admin/finance/journal?account=ledger:${l.id}`}><strong>{l.name_en}</strong></Link>{l.name_ar ? <div className="small muted" dir="rtl">{l.name_ar}</div> : null}</td>
                  <td className="small">{LEDGER_KINDS[l.kind]?.en} · {LEDGER_KINDS[l.kind]?.ar}</td>
                  <td className="num small nowrap">{mm(lb.get(l.id) ?? new Map())}</td>
                  <td>
                    <details className="inline-details">
                      <summary className="btn secondary small">Edit</summary>
                      <ActionForm action={saveLedgerAccount.bind(null, l.id)} className="form-grid inline-form wide">
                        <div className="field"><label>Code</label><input type="text" name="code" defaultValue={l.code} maxLength={12} /></div>
                        <div className="field"><label>Type</label><select name="kind" defaultValue={l.kind}>{Object.entries(LEDGER_KINDS).map(([k, v]) => <option key={k} value={k}>{v.en} · {v.ar}</option>)}</select></div>
                        <div className="field"><label>Name (English)</label><input type="text" name="name_en" defaultValue={l.name_en} maxLength={120} /></div>
                        <div className="field"><label>Name (Arabic)</label><input type="text" name="name_ar" defaultValue={l.name_ar ?? ""} maxLength={120} dir="rtl" /></div>
                        <div className="field"><label className="small"><input type="checkbox" name="active" defaultChecked={l.active} /> Active</label></div>
                        <div className="full"><SubmitButton className="btn small">Save</SubmitButton></div>
                      </ActionForm>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <details style={{ marginTop: 12 }}>
          <summary><strong>+ Add an account · إضافة حساب</strong></summary>
          <ActionForm action={saveLedgerAccount.bind(null, null)} className="form-grid" resetOnSuccess>
            <div className="field"><label htmlFor="la-code">Code *</label><input id="la-code" type="text" name="code" maxLength={12} required placeholder="e.g. 5400" /></div>
            <div className="field"><label htmlFor="la-kind">Type</label><select id="la-kind" name="kind" defaultValue="expense">{Object.entries(LEDGER_KINDS).map(([k, v]) => <option key={k} value={k}>{v.en} · {v.ar}</option>)}</select></div>
            <div className="field"><label htmlFor="la-en">Name (English) *</label><input id="la-en" type="text" name="name_en" maxLength={120} required /></div>
            <div className="field"><label htmlFor="la-ar">Name (Arabic)</label><input id="la-ar" type="text" name="name_ar" maxLength={120} dir="rtl" /></div>
            <div className="full"><SubmitButton className="btn teal">Add account</SubmitButton></div>
          </ActionForm>
        </details>
      </section>
    </>
  );
}
