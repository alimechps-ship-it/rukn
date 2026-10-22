import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { ALL_CATEGORIES, IN_CATEGORIES, OUT_CATEGORIES, type CashAccount, type CashEntry } from "@/lib/finance";
import { addCashEntry, updateCashEntry, voidCashEntry } from "../_actions/finance";

export type Person = { id: string; name: string };
const today = () => new Date().toISOString().slice(0, 10);

export function PartyFields({ people, entry, idp }: { people: Person[]; entry?: Pick<CashEntry, "party_user" | "party_name">; idp: string }) {
  return (
    <>
      <div className="field"><label htmlFor={`${idp}-pu`}>Person (team member) · الشخص</label>
        <select id={`${idp}-pu`} name="party_user" defaultValue={entry?.party_user ?? ""}>
          <option value="">— not a team member / none —</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="field"><label htmlFor={`${idp}-pn`}>…or type a name · أو اكتب الاسم</label>
        <input id={`${idp}-pn`} type="text" name="party_name" maxLength={120} defaultValue={entry?.party_name ?? ""} placeholder="e.g. Ahmed (courier), supplier name" />
      </div>
    </>
  );
}

export function NewEntryForm({ direction, accounts, people, defaultAccount }: { direction: "in" | "out"; accounts: (CashAccount & { balance: number })[]; people: Person[]; defaultAccount?: string }) {
  const cats = direction === "in" ? IN_CATEGORIES : OUT_CATEGORIES;
  const idp = `new-${direction}`;
  return (
    <ActionForm action={addCashEntry} className="form-grid" resetOnSuccess>
      <input type="hidden" name="direction" value={direction} />
      <div className="field"><label htmlFor={`${idp}-acc`}>Cash box · الصندوق *</label>
        <select id={`${idp}-acc`} name="account_id" defaultValue={defaultAccount ?? accounts.find((a) => a.active)?.id}>
          {accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency}) — balance {a.balance.toLocaleString("en-US", { minimumFractionDigits: 2 })}</option>)}
        </select>
      </div>
      <div className="field"><label htmlFor={`${idp}-amt`}>Amount · المبلغ *</label><input id={`${idp}-amt`} type="number" name="amount" min="0.01" step="0.01" required /></div>
      <div className="field"><label htmlFor={`${idp}-cat`}>Type · النوع *</label>
        <select id={`${idp}-cat`} name="category" defaultValue={direction === "in" ? "owner_deposit" : "advance"}>
          {Object.entries(cats).map(([k, c]) => <option key={k} value={k}>{c.en} · {c.ar}</option>)}
        </select>
      </div>
      <div className="field"><label htmlFor={`${idp}-date`}>Date · التاريخ</label><input id={`${idp}-date`} type="date" name="entry_date" defaultValue={today()} /></div>
      <PartyFields people={people} idp={idp} />
      <div className="field full"><label htmlFor={`${idp}-desc`}>Description · البيان</label><input id={`${idp}-desc`} type="text" name="description" maxLength={500} placeholder={direction === "in" ? "e.g. capital deposit for October" : "e.g. courier advance for DHL shipments"} /></div>
      <div className="field"><label htmlFor={`${idp}-ref`}>Reference · مرجع</label><input id={`${idp}-ref`} type="text" name="reference" maxLength={120} placeholder="invoice / transfer no." /></div>
      <div className="field" style={{ alignSelf: "end" }}>
        <SubmitButton className={`btn ${direction === "in" ? "teal" : ""}`}>{direction === "in" ? "Record receipt · سند قبض" : "Record payment · سند صرف"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function EditEntryForm({ entry, people }: { entry: CashEntry; people: Person[] }) {
  const linked = Boolean(entry.case_payment_id || entry.transfer_group);
  const cats = entry.direction === "in" ? IN_CATEGORIES : OUT_CATEGORIES;
  const idp = `e-${entry.id.slice(0, 8)}`;
  return (
    <ActionForm action={updateCashEntry.bind(null, entry.id)} className="form-grid inline-form wide">
      {linked ? <p className="small muted full" style={{ margin: 0 }}>Linked to a {entry.case_payment_id ? "case payment" : "transfer"}: amount, date and type follow it — void it there to cancel.</p> : (
        <>
          <div className="field"><label htmlFor={`${idp}-amt`}>Amount</label><input id={`${idp}-amt`} type="number" name="amount" min="0.01" step="0.01" defaultValue={Number(entry.amount)} /></div>
          <div className="field"><label htmlFor={`${idp}-date`}>Date</label><input id={`${idp}-date`} type="date" name="entry_date" defaultValue={entry.entry_date} /></div>
          <div className="field full"><label htmlFor={`${idp}-cat`}>Type</label>
            <select id={`${idp}-cat`} name="category" defaultValue={entry.category}>
              {Object.entries(cats).map(([k, c]) => <option key={k} value={k}>{c.en} · {c.ar}</option>)}
            </select>
          </div>
        </>
      )}
      <PartyFields people={people} entry={entry} idp={idp} />
      <div className="field full"><label htmlFor={`${idp}-desc`}>Description</label><input id={`${idp}-desc`} type="text" name="description" maxLength={500} defaultValue={entry.description ?? ""} /></div>
      <div className="field full"><label htmlFor={`${idp}-ref`}>Reference</label><input id={`${idp}-ref`} type="text" name="reference" maxLength={120} defaultValue={entry.reference ?? ""} /></div>
      <div className="full"><SubmitButton className="btn small">Save voucher</SubmitButton></div>
    </ActionForm>
  );
}

export const catLabel = (k: string) => ALL_CATEGORIES[k]?.en ?? k;

/** Vouchers table with print / edit / void, optional running balance. */
export function EntriesTable({ entries, accounts, people, names, running }: {
  entries: CashEntry[]; accounts: Map<string, { name: string; currency: string }>; people: Person[];
  names: Map<string, string>; running?: Map<string, number>;
}) {
  const fmt = (n: number, c: string) => `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`;
  if (!entries.length) return <p className="small muted">No vouchers yet.</p>;
  return (
    <div className="table-scroll">
      <table className="data">
        <thead><tr><th>Voucher</th><th>Date</th><th>Box</th><th style={{ minWidth: 130 }}>Type / person</th><th style={{ minWidth: 150 }}>Description</th><th className="num">In</th><th className="num">Out</th>{running ? <th className="num">Balance</th> : null}<th /></tr></thead>
        <tbody>
          {entries.map((e) => {
            const who = e.party_user ? names.get(e.party_user) : e.party_name;
            return (
              <tr key={e.id} style={e.voided ? { opacity: 0.5 } : undefined}>
                <td className="mono nowrap">{e.entry_no}{e.voided ? <div><span className="pill closed">void</span></div> : null}</td>
                <td className="nowrap small">{new Date(e.entry_date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</td>
                <td className="small">{accounts.get(e.account_id)?.name}</td>
                <td className="small">{catLabel(e.category)}{who ? <div><strong>{who}</strong></div> : null}</td>
                <td className="small">{e.description}{e.reference ? <div className="muted">Ref. {e.reference}</div> : null}{e.voided && e.void_reason ? <div className="muted">Void: {e.void_reason}</div> : null}</td>
                <td className="num nowrap" style={{ color: "#067647" }}>{e.direction === "in" ? fmt(Number(e.amount), e.currency) : ""}</td>
                <td className="num nowrap" style={{ color: "#b42318" }}>{e.direction === "out" ? fmt(Number(e.amount), e.currency) : ""}</td>
                {running ? <td className="num nowrap"><strong>{running.has(e.id) ? fmt(running.get(e.id)!, e.currency) : ""}</strong></td> : null}
                <td className="nowrap">
                  <a className="btn secondary small" href={`/admin/print/cash/${e.id}`} target="_blank" rel="noopener" title="Print voucher">🖨</a>{" "}
                  {!e.voided ? (
                    <>
                      <details className="inline-details" style={{ display: "inline-block" }}>
                        <summary className="btn secondary small">Edit</summary>
                        <EditEntryForm entry={e} people={people} />
                      </details>{" "}
                      {!e.case_payment_id ? (
                        <details className="inline-details" style={{ display: "inline-block" }}>
                          <summary className="btn danger small">Void</summary>
                          <ActionForm action={voidCashEntry} className="inline-form">
                            <input type="hidden" name="id" value={e.id} />
                            <input type="text" name="reason" placeholder="Reason for voiding" aria-label="Reason" maxLength={300} required />
                            <SubmitButton className="btn danger small">Void</SubmitButton>
                          </ActionForm>
                        </details>
                      ) : null}
                    </>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
