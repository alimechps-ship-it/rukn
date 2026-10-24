import "server-only";
import type { Db } from "./admin";
import { accountsWithBalance } from "./finance";
import type { JournalEntry, LedgerAccount } from "./journal";
import { partnerBalances } from "./partners";
import { loadStatements } from "./statement";

/** Balance per currency, debit-positive (Dr +, Cr −). */
export type Bal = Map<string, number>;
export interface CoaNode {
  key: string; kind: "ledger" | "cash" | "agent" | "partner"; id: string; code: string; name: string; name_ar: string | null;
  group: boolean; subledger: string | null; active: boolean; type: string; balance: Bal; children: CoaNode[]; href: string | null; account?: LedgerAccount;
}

const add = (m: Bal, c: string, v: number) => m.set(c, Math.round(((m.get(c) ?? 0) + v) * 100) / 100);
const merge = (into: Bal, from: Bal) => { for (const [c, v] of from) add(into, c, v); };

/**
 * The account tree with live balances:
 *  general accounts ← journal entries · cash boxes ← their vouchers · agents ← their statement · labs / clinics ← what RUKN owes.
 */
export async function loadChart(db: Db) {
  const [{ data: rows }, { data: entries }, boxes, st, pb, { data: partners }] = await Promise.all([
    db.from("ledger_accounts").select("*").order("code"),
    db.from("journal_entries").select("dr_ledger_id,cr_ledger_id,dr_amount,cr_amount,dr_currency,cr_currency,voided").eq("voided", false).limit(50000),
    accountsWithBalance(db),
    loadStatements(db, {}),
    partnerBalances(db),
    db.from("partners").select("id,name,kind,active").order("name"),
  ]);
  const ledgers = (rows ?? []) as LedgerAccount[];
  const lb = new Map<string, Bal>();
  for (const e of (entries ?? []) as Partial<JournalEntry>[]) {
    if (e.dr_ledger_id) { if (!lb.has(e.dr_ledger_id)) lb.set(e.dr_ledger_id, new Map()); add(lb.get(e.dr_ledger_id)!, e.dr_currency!, Number(e.dr_amount)); }
    if (e.cr_ledger_id) { if (!lb.has(e.cr_ledger_id)) lb.set(e.cr_ledger_id, new Map()); add(lb.get(e.cr_ledger_id)!, e.cr_currency!, -Number(e.cr_amount)); }
  }
  const agentIds = st.totals.map((t) => t.agent);
  const { data: profiles } = agentIds.length ? await db.from("profiles").select("id,full_name,email").in("id", agentIds) : { data: [] };
  const agentName = new Map((profiles ?? []).map((p) => [p.id as string, (p.full_name || p.email) as string]));

  const nodes = new Map<string, CoaNode>();
  for (const l of ledgers) nodes.set(l.id, {
    key: `ledger:${l.id}`, kind: "ledger", id: l.id, code: l.code, name: l.name_en, name_ar: l.name_ar, group: l.is_group, subledger: l.subledger,
    active: l.active, type: l.kind, balance: new Map(lb.get(l.id) ?? []), children: [], href: l.is_group ? null : `/admin/finance/journal?account=ledger:${l.id}`, account: l,
  });
  const roots: CoaNode[] = [];
  for (const l of ledgers) { const n = nodes.get(l.id)!; const p = l.parent_id ? nodes.get(l.parent_id) : undefined; (p ? p.children : roots).push(n); }

  // live sub-ledgers
  const sub = (k: string) => ledgers.find((l) => l.subledger === k);
  const cashG = sub("cash"); const agentsG = sub("agents"); const labsG = sub("labs"); const clinicsG = sub("clinics");
  boxes.forEach((b, i) => cashG && nodes.get(cashG.id)!.children.push({
    key: `cash:${b.id}`, kind: "cash", id: b.id, code: `${cashG.code}.${String(i + 1).padStart(2, "0")}`, name: `${b.name} (${b.currency})`, name_ar: null,
    group: false, subledger: null, active: b.active, type: "asset", balance: new Map([[b.currency, b.balance]]), children: [], href: `/admin/finance/cash/${b.id}`,
  }));
  [...st.totals].sort((a, b) => (agentName.get(a.agent) ?? "").localeCompare(agentName.get(b.agent) ?? "")).forEach((t, i) => agentsG && nodes.get(agentsG.id)!.children.push({
    key: `agent:${t.agent}`, kind: "agent", id: t.agent, code: `${agentsG.code}.${String(i + 1).padStart(3, "0")}`, name: agentName.get(t.agent) ?? "Agent", name_ar: null,
    group: false, subledger: null, active: true, type: "asset", balance: new Map(t.balance), children: [], href: `/admin/statement?agent=${t.agent}`,
  }));
  let li = 0; let ci = 0;
  for (const p of partners ?? []) {
    const g = p.kind === "lab" ? labsG : clinicsG; if (!g) continue;
    const owed = pb.get(p.id as string)?.owed ?? new Map<string, number>();
    const bal: Bal = new Map(); for (const [c, v] of owed) add(bal, c, -v); // RUKN owes → credit balance
    const n = p.kind === "lab" ? ++li : ++ci;
    nodes.get(g.id)!.children.push({
      key: `partner:${p.id}`, kind: "partner", id: p.id as string, code: `${g.code}.${String(n).padStart(3, "0")}`, name: p.name as string, name_ar: null,
      group: false, subledger: null, active: Boolean(p.active), type: "liability", balance: bal, children: [], href: `/admin/partners/${p.id}`,
    });
  }
  // roll balances up
  const roll = (n: CoaNode): Bal => { for (const c of n.children) merge(n.balance, roll(c)); return n.balance; };
  roots.forEach(roll);
  const sortTree = (list: CoaNode[]) => { list.sort((a, b) => (a.kind === "ledger" && b.kind === "ledger" ? a.code.localeCompare(b.code, "en", { numeric: true }) : 0)); list.forEach((c) => sortTree(c.children)); };
  sortTree(roots);
  return { roots, ledgers };
}
