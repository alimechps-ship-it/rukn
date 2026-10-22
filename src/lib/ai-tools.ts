import "server-only";
import type { Db } from "./admin";
import type { ToolDef } from "./ai";
import { ALL_STATUSES, countryName, STATUS, withQuote, type CaseStatus } from "./cases";
import { accountsWithBalance, ALL_CATEGORIES, loadPeople, loadReceivables, netMap } from "./finance";
import { loadStatements } from "./statement";

/**
 * Read-only tools the dashboard assistant can call. Every query runs with the
 * signed-in user's session, so Row Level Security limits what the AI can see
 * exactly like the screens do. Nothing here writes data.
 */
const DATE = { type: "string", description: "Date YYYY-MM-DD" };
export const ASSISTANT_TOOLS: ToolDef[] = [
  {
    name: "search_cases",
    description: "Find cases. Filter by free text (case code, clinic, doctor, patient reference), status, agent name, country code (2 letters) or creation period. Returns up to 50 cases with status, agent, price.",
    input_schema: { type: "object", properties: {
      query: { type: "string" }, status: { type: "string", enum: ALL_STATUSES }, agent_name: { type: "string" },
      country: { type: "string", description: "ISO country code, e.g. EG, SA, DE" }, from: DATE, to: DATE, open_only: { type: "boolean" },
      limit: { type: "integer", minimum: 1, maximum: 50 },
    } },
  },
  {
    name: "get_case",
    description: "Full details of one case by its code (e.g. RK-EG-26-00012): status, clinic, agent, dates, invoices, payments, payment notices and the latest timeline events.",
    input_schema: { type: "object", properties: { code: { type: "string" } }, required: ["code"] },
  },
  {
    name: "case_stats",
    description: "Count cases grouped by status, agent, country or service, optionally for a creation period. Also returns average days from creation to delivery.",
    input_schema: { type: "object", properties: { group_by: { type: "string", enum: ["status", "agent", "country", "service"] }, from: DATE, to: DATE }, required: ["group_by"] },
  },
  {
    name: "receivables",
    description: "Unpaid issued invoices (money owed to RUKN) with ageing buckets, totals per currency and per agent. Optional filters: agent name, overdue only.",
    input_schema: { type: "object", properties: { agent_name: { type: "string" }, overdue_only: { type: "boolean" } } },
  },
  {
    name: "agent_balances",
    description: "Account of agents with RUKN: invoiced, paid, balance due and payments awaiting confirmation, per currency. Optional agent name for one agent with his movements.",
    input_schema: { type: "object", properties: { agent_name: { type: "string" }, from: DATE, to: DATE } },
  },
  {
    name: "cash_summary",
    description: "Cash boxes: current balance of every box, and money in / out per category for an optional period.",
    input_schema: { type: "object", properties: { from: DATE, to: DATE } },
  },
  {
    name: "person_accounts",
    description: "What each person took from the cash boxes (custody, withdrawals, salaries…) and returned. Optional person name filter and period.",
    input_schema: { type: "object", properties: { name: { type: "string" }, from: DATE, to: DATE } },
  },
  {
    name: "payment_notices",
    description: "Payment notices sent by agents, by default only those awaiting confirmation, including the AI check of the transfer receipt.",
    input_schema: { type: "object", properties: { status: { type: "string", enum: ["pending", "accepted", "rejected", "cancelled", "all"] } } },
  },
];

const iso = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
const r2 = (n: number) => Math.round(n * 100) / 100;
const obj = (m: Map<string, number>) => Object.fromEntries([...m.entries()].map(([k, v]) => [k, r2(v)]));

async function agentsByName(db: Db, name: string) {
  const t = name.replace(/[%_,()]/g, " ").trim();
  if (!t) return [];
  const { data } = await db.from("profiles").select("id,full_name,email").or(`full_name.ilike.%${t}%,email.ilike.%${t}%`).limit(10);
  return (data ?? []) as { id: string; full_name: string | null; email: string }[];
}
async function names(db: Db, ids: string[]) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return new Map<string, string>();
  const { data } = await db.from("profiles").select("id,full_name,email").in("id", list);
  return new Map((data ?? []).map((p) => [p.id as string, (p.full_name || p.email) as string]));
}

/** Tools without money data — all that a case manager (operations only) may use. */
export const OPS_TOOL_NAMES = ["search_cases", "get_case", "case_stats"];
export const toolsFor = (finance: boolean) => (finance ? ASSISTANT_TOOLS : ASSISTANT_TOOLS.filter((t) => OPS_TOOL_NAMES.includes(t.name)));

export async function runAssistantTool(db: Db, name: string, input: Record<string, unknown>, finance = true): Promise<unknown> {
  if (!finance && !OPS_TOOL_NAMES.includes(name)) return { error: "Money data is visible to the finance manager only." };
  switch (name) {
    case "search_cases": {
      let q = db.from("cases").select("id,code,status,priority,clinic_name,doctor_name,patient_ref,agent_id,country_code,service_label,case_finance(quote_amount,quote_currency),created_at,delivered_at")
        .order("created_at", { ascending: false }).limit(Math.min(50, Number(input.limit) || 25));
      if (typeof input.status === "string" && ALL_STATUSES.includes(input.status as CaseStatus)) q = q.eq("status", input.status);
      if (input.open_only) q = q.not("status", "in", "(delivered,cancelled)");
      if (typeof input.country === "string" && /^[A-Za-z]{2}$/.test(input.country)) q = q.eq("country_code", input.country.toUpperCase());
      if (iso(input.from)) q = q.gte("created_at", `${input.from}T00:00:00Z`);
      if (iso(input.to)) q = q.lte("created_at", `${input.to}T23:59:59Z`);
      if (typeof input.agent_name === "string" && input.agent_name.trim()) {
        const ag = await agentsByName(db, input.agent_name);
        if (!ag.length) return { error: `No agent matches "${input.agent_name}".` };
        q = q.in("agent_id", ag.map((a) => a.id));
      }
      if (typeof input.query === "string" && input.query.trim()) {
        const t = input.query.replace(/[%_,()]/g, " ").trim().slice(0, 60);
        q = q.or(`code.ilike.%${t}%,clinic_name.ilike.%${t}%,doctor_name.ilike.%${t}%,patient_ref.ilike.%${t}%`);
      }
      const { data, error } = await q;
      if (error) return { error: error.message };
      const nm = await names(db, (data ?? []).map((c) => c.agent_id as string));
      return { count: (data ?? []).length, cases: ((data ?? []) as Record<string, unknown>[]).map(withQuote).map((c) => ({
        code: c.code, status: STATUS[c.status as CaseStatus]?.en, priority: c.priority, clinic: c.clinic_name, doctor: c.doctor_name, patient_ref: c.patient_ref,
        agent: nm.get(c.agent_id as string), country: countryName(c.country_code as string), service: c.service_label,
        price: c.quote_amount ? `${c.quote_amount} ${c.quote_currency}` : null, created: String(c.created_at).slice(0, 10), delivered: c.delivered_at ? String(c.delivered_at).slice(0, 10) : null,
      })) };
    }
    case "get_case": {
      const code = String(input.code ?? "").trim().toUpperCase();
      const { data: c0 } = await db.from("cases").select("*,case_finance(quote_amount,quote_currency)").eq("code", code).maybeSingle();
      const c = c0 ? withQuote(c0 as Record<string, any>) : null; // eslint-disable-line @typescript-eslint/no-explicit-any
      if (!c) return { error: `Case ${code} not found (or not visible to you).` };
      const [{ data: invs }, { data: pays }, { data: notices }, { data: events }] = !finance ? [{ data: null }, { data: null }, { data: null }, await db.from("case_events").select("kind,body,from_status,to_status,created_at").eq("case_id", c.id).order("created_at", { ascending: false }).limit(12)] : await Promise.all([
        db.from("case_invoices").select("invoice_no,status,issue_date,due_date,currency,total,revision").eq("case_id", c.id),
        db.from("case_payments").select("receipt_no,amount,currency,method,paid_at,voided,invoice_id").eq("case_id", c.id),
        db.from("case_payment_claims").select("notice_no,status,amount,currency,paid_at,reference,ai_status,ai_summary").eq("case_id", c.id),
        db.from("case_events").select("kind,body,from_status,to_status,created_at").eq("case_id", c.id).order("created_at", { ascending: false }).limit(12),
      ]);
      const nm = await names(db, [c.agent_id, c.assigned_to]);
      return {
        code: c.code, status: STATUS[c.status as CaseStatus]?.en, priority: c.priority, service: c.service_label,
        clinic: c.clinic_name, doctor: c.doctor_name, city: c.city, country: countryName(c.country_code), patient_ref: c.patient_ref,
        agent: nm.get(c.agent_id), case_manager: c.assigned_to ? nm.get(c.assigned_to) : null,
        created: c.created_at, records_received: c.intake_received_at, plan_approved: c.plan_approved_at ? `${c.plan_approved_at} by ${c.plan_approved_by}` : null,
        shipped: c.shipped_at ? `${c.shipped_at} ${c.carrier ?? ""} ${c.tracking_no ?? ""}` : null, delivered: c.delivered_at ? `${c.delivered_at} to ${c.received_by_name ?? ""}` : null,
        ...(finance ? { price: c.quote_amount ? `${c.quote_amount} ${c.quote_currency}` : null, invoices: invs, payments: pays, payment_notices: notices } : {}),
        latest_events: (events ?? []).map((e) => ({ at: String(e.created_at).slice(0, 16), kind: e.kind, text: e.body ?? `${e.from_status ?? ""} → ${e.to_status ?? ""}` })),
      };
    }
    case "case_stats": {
      let q = db.from("cases").select("status,agent_id,country_code,service_label,created_at,delivered_at").limit(10000);
      if (iso(input.from)) q = q.gte("created_at", `${input.from}T00:00:00Z`);
      if (iso(input.to)) q = q.lte("created_at", `${input.to}T23:59:59Z`);
      const { data } = await q;
      const rows = data ?? [];
      const g = String(input.group_by);
      const counts = new Map<string, number>();
      for (const r of rows) {
        const k = g === "agent" ? (r.agent_id as string) : g === "country" ? (r.country_code as string) : g === "service" ? ((r.service_label as string) ?? "—") : (r.status as string);
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      const nm = g === "agent" ? await names(db, [...counts.keys()]) : new Map<string, string>();
      const label = (k: string) => (g === "agent" ? nm.get(k) ?? k : g === "country" ? countryName(k) : g === "status" ? STATUS[k as CaseStatus]?.en ?? k : k);
      const days = rows.filter((r) => r.delivered_at).map((r) => (Date.parse(r.delivered_at as string) - Date.parse(r.created_at as string)) / 86400000);
      return { total: rows.length, groups: Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [label(k), v])),
        avg_days_to_delivery: days.length ? r2(days.reduce((a, b) => a + b, 0) / days.length) : null };
    }
    case "receivables": {
      let agent: string | undefined;
      if (typeof input.agent_name === "string" && input.agent_name.trim()) {
        const ag = await agentsByName(db, input.agent_name);
        if (!ag.length) return { error: `No agent matches "${input.agent_name}".` };
        agent = ag[0].id;
      }
      const r = await loadReceivables(db, { agent, bucket: input.overdue_only ? "overdue" : undefined });
      const nm = await names(db, [...r.byAgent.keys()]);
      return {
        open_invoices: r.rows.length, total_outstanding: obj(r.byCurrency),
        by_age: Object.fromEntries([...r.byBucket.entries()].map(([k, m]) => [k, obj(m)])),
        by_agent: Object.fromEntries([...r.byAgent.entries()].map(([k, m]) => [nm.get(k) ?? k, obj(m)])),
        oldest: r.rows.slice(0, 15).map((x) => ({ invoice: x.invoice_no, case: x.code, clinic: x.clinic_name, due: x.due_date, days_late: Math.max(0, x.days), balance: `${x.balance} ${x.currency}` })),
        cases_without_invoice: r.unbilled.length,
      };
    }
    case "agent_balances": {
      let agent: string | null = null;
      if (typeof input.agent_name === "string" && input.agent_name.trim()) {
        const ag = await agentsByName(db, input.agent_name);
        if (!ag.length) return { error: `No agent matches "${input.agent_name}".` };
        agent = ag[0].id;
      }
      const st = await loadStatements(db, { agent, from: iso(input.from), to: iso(input.to) });
      const nm = await names(db, st.totals.map((t) => t.agent));
      return {
        agents: st.totals.map((t) => ({ agent: nm.get(t.agent), cases: t.cases, invoiced: obj(t.invoiced), paid: obj(t.paid), balance_due: obj(t.balance), awaiting_confirmation: obj(t.pending) })),
        ...(agent ? { movements: st.lines.slice(-40).map((l) => ({ date: l.date, document: l.doc, case: l.code, debit: l.debit, credit: l.credit, currency: l.currency, balance: l.balance })) } : {}),
      };
    }
    case "cash_summary": {
      const accounts = await accountsWithBalance(db);
      let q = db.from("cash_entries").select("direction,amount,currency,category,entry_date").eq("voided", false).limit(10000);
      if (iso(input.from)) q = q.gte("entry_date", input.from as string);
      if (iso(input.to)) q = q.lte("entry_date", input.to as string);
      const { data } = await q;
      const flow = new Map<string, Map<string, number>>();
      for (const e of data ?? []) {
        const k = `${e.direction === "in" ? "in" : "out"} · ${ALL_CATEGORIES[e.category as string]?.en ?? e.category}`;
        if (!flow.has(k)) flow.set(k, new Map());
        const m = flow.get(k)!; m.set(e.currency as string, r2((m.get(e.currency as string) ?? 0) + Number(e.amount)));
      }
      return { boxes: accounts.map((a) => ({ box: a.name, type: a.kind, currency: a.currency, balance: a.balance, open: a.active })),
        movements_in_period: Object.fromEntries([...flow.entries()].map(([k, m]) => [k, obj(m)])) };
    }
    case "person_accounts": {
      const { people } = await loadPeople(db, iso(input.from), iso(input.to));
      const nm = await names(db, people.map((p) => p.user ?? ""));
      const needle = typeof input.name === "string" ? input.name.trim().toLowerCase() : "";
      return { people: people.map((p) => ({ person: p.user ? nm.get(p.user) : p.name, took: obj(p.taken), returned: obj(p.returned), net_still_with_person: obj(netMap(p.taken, p.returned)), vouchers: p.entries.length }))
        .filter((p) => !needle || String(p.person ?? "").toLowerCase().includes(needle)) };
    }
    case "payment_notices": {
      const status = typeof input.status === "string" ? input.status : "pending";
      let q = db.from("case_payment_claims").select("notice_no,status,amount,currency,method,paid_at,reference,case_id,submitted_by,ai_status,ai_summary,created_at").order("created_at", { ascending: false }).limit(50);
      if (status !== "all") q = q.eq("status", status);
      const { data } = await q;
      const ids = [...new Set((data ?? []).map((n) => n.case_id as string))];
      const { data: cs } = ids.length ? await db.from("cases").select("id,code").in("id", ids) : { data: [] };
      const codes = new Map((cs ?? []).map((c) => [c.id as string, c.code as string]));
      const nm = await names(db, (data ?? []).map((n) => n.submitted_by as string));
      return { count: (data ?? []).length, notices: (data ?? []).map((n) => ({ notice: n.notice_no, status: n.status, case: codes.get(n.case_id as string), agent: nm.get(n.submitted_by as string),
        amount: `${n.amount} ${n.currency}`, method: n.method, date: n.paid_at, reference: n.reference, ai_check: n.ai_status, ai_note: n.ai_summary })) };
    }
  }
  return { error: `Unknown tool ${name}` };
}
