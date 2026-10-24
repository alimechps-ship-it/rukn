import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { can, requireStaff } from "@/lib/auth";
import { createSessionClient } from "@/lib/admin";
import { fmtMoney } from "@/lib/cases";
import { loadChart, type Bal, type CoaNode } from "@/lib/coa";
import { LEDGER_KINDS, type LedgerAccount } from "@/lib/journal";
import { saveLedgerAccount } from "../../_actions/journal";

export const metadata = { title: "Chart of accounts" };

const balText = (b: Bal) => {
  const parts = [...b.entries()].filter(([, v]) => Math.abs(v) >= 0.005).sort(([a], [c]) => a.localeCompare(c));
  return parts.length ? parts.map(([c, v]) => <div key={c} className="nowrap" style={{ color: v < 0 ? "#067647" : undefined }}>{v < 0 ? "Cr" : "Dr"} {fmtMoney(Math.abs(v), c)}</div>) : <span className="muted">—</span>;
};
const KIND_BADGE: Record<CoaNode["kind"], string> = { ledger: "", cash: "Cash box · صندوق", agent: "Agent · مندوب", partner: "Lab / clinic · شريك" };

function AccountForm({ a, groups }: { a?: LedgerAccount; groups: LedgerAccount[] }) {
  const idp = a ? a.id.slice(0, 8) : "new";
  return (
    <ActionForm action={saveLedgerAccount.bind(null, a?.id ?? null)} className="form-grid inline-form wide" resetOnSuccess={!a}>
      <div className="field"><label htmlFor={`la-p-${idp}`}>Under (main account) · يتبع</label>
        <select id={`la-p-${idp}`} name="parent_id" defaultValue={a?.parent_id ?? ""}>
          <option value="">— top level —</option>
          {groups.filter((g) => g.id !== a?.id).map((g) => <option key={g.id} value={g.id}>{g.code} · {g.name_en}{g.name_ar ? ` · ${g.name_ar}` : ""}</option>)}
        </select>
      </div>
      <div className="field"><label htmlFor={`la-c-${idp}`}>Code · الرقم *</label><input id={`la-c-${idp}`} type="text" name="code" maxLength={12} required defaultValue={a?.code ?? ""} placeholder="e.g. 5400" /></div>
      <div className="field"><label htmlFor={`la-en-${idp}`}>Name (English) *</label><input id={`la-en-${idp}`} type="text" name="name_en" maxLength={120} required defaultValue={a?.name_en ?? ""} /></div>
      <div className="field"><label htmlFor={`la-ar-${idp}`}>Name (Arabic) · الاسم</label><input id={`la-ar-${idp}`} type="text" name="name_ar" maxLength={120} dir="rtl" defaultValue={a?.name_ar ?? ""} /></div>
      <div className="field"><label htmlFor={`la-k-${idp}`}>Type · النوع</label>
        <select id={`la-k-${idp}`} name="kind" defaultValue={a?.kind ?? "expense"}>{Object.entries(LEDGER_KINDS).map(([k, v]) => <option key={k} value={k}>{v.en} · {v.ar}</option>)}</select>
      </div>
      <div className="field" style={{ alignSelf: "end" }}>
        <label className="small"><input type="checkbox" name="is_group" defaultChecked={a?.is_group ?? false} disabled={Boolean(a?.subledger)} /> Main account (has sub-accounts) · حساب رئيسي</label>
        {a ? <label className="small"><input type="checkbox" name="active" defaultChecked={a.active} /> Active · فعال</label> : null}
      </div>
      <div className="full"><SubmitButton className={`btn ${a ? "small" : "teal"}`}>{a ? "Save" : "Add account · إضافة حساب"}</SubmitButton></div>
    </ActionForm>
  );
}

function Row({ n, depth }: { n: CoaNode; depth: number }) {
  const head = (
    <div className={`coa-row ${n.group ? "group" : ""} ${n.active ? "" : "inactive"}`} style={{ paddingInlineStart: 8 + depth * 22 }}>
      <span className="mono coa-code">{n.code}</span>
      <span className="coa-name">
        {n.href ? <Link href={n.href}>{n.name}</Link> : <strong>{n.name}</strong>}
        {n.name_ar ? <span className="muted" dir="rtl" style={{ display: "inline-block", marginLeft: 12, marginRight: 4 }}>{n.name_ar}</span> : null}
        {KIND_BADGE[n.kind] ? <span className="pill draft" style={{ marginInlineStart: 6 }}>{KIND_BADGE[n.kind]}</span> : null}
        {n.subledger ? <span className="small muted"> · {n.children.length} account(s), automatic</span> : null}
        {!n.active ? <span className="pill archived" style={{ marginInlineStart: 6 }}>inactive</span> : null}
      </span>
      <span className="coa-type small muted">{n.kind === "ledger" ? `${LEDGER_KINDS[n.type]?.en ?? ""} · ${LEDGER_KINDS[n.type]?.ar ?? ""}` : ""}</span>
      <span className="coa-bal num small">{balText(n.balance)}</span>
      <span className="coa-act">
        {n.kind === "ledger" && n.account ? <Link className="btn secondary small" href={`/admin/finance/accounts?edit=${n.id}#edit`}>Edit</Link> : null}
      </span>
    </div>
  );
  if (!n.children.length) return <li>{head}</li>;
  return (
    <li>
      <details open={depth < 2 && !n.subledger}>
        <summary>{head}</summary>
        <ul className="coa-list">{n.children.map((c) => <Row key={c.key} n={c} depth={depth + 1} />)}</ul>
      </details>
    </li>
  );
}

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const sp = await searchParams;
  await requireStaff(can.finance);
  const db = await createSessionClient();
  const { roots, ledgers } = await loadChart(db);
  const groups = ledgers.filter((l) => l.is_group && !l.subledger);
  const editing = sp.edit ? ledgers.find((l) => l.id === sp.edit) : undefined;
  return (
    <>
      <div className="topbar">
        <div>
          <h1>Chart of accounts · شجرة الحسابات</h1>
          <div className="sub">Main accounts total their sub-accounts. Cash boxes, agents, labs and clinics appear automatically under their main accounts with their live balances. Balances per currency: Dr = debit, Cr = credit.</div>
        </div>
        <div className="btn-row"><Link className="btn teal" href="/admin/finance/journal">+ Journal entry · قيد</Link></div>
      </div>
      {editing ? (
        <section className="panel" id="edit">
          <div className="panel-head"><h2>Edit account · تعديل حساب: {editing.code} {editing.name_en}</h2><Link className="btn secondary small" href="/admin/finance/accounts">Close</Link></div>
          <AccountForm a={editing} groups={groups} />
          {editing.subledger ? <p className="small muted">Its sub-accounts (boxes, agents or partners) are added automatically.</p> : null}
        </section>
      ) : null}
      <section className="panel">
        <div className="coa-row coa-head"><span className="coa-code">Code · الرقم</span><span className="coa-name">Account · الحساب</span><span className="coa-type">Type · النوع</span><span className="coa-bal num">Balance · الرصيد</span><span className="coa-act" /></div>
        <ul className="coa-list root">{roots.map((n) => <Row key={n.key} n={n} depth={0} />)}</ul>
      </section>
      <section className="panel">
        <h2>+ Add an account · إضافة حساب</h2>
        <AccountForm groups={groups} />
        <p className="small muted">Choose the main account it belongs to. Tick “Main account” for a heading that will hold sub-accounts (only sub-accounts are used in entries).</p>
      </section>
    </>
  );
}
