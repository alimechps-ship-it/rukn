import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { createSessionClient, fmtDate } from "@/lib/admin";

export const metadata = { title: "Activity log" };
const PER = 100;

export default async function Activity({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requireStaff();
  const page = Math.max(1, Number((await searchParams).page ?? 1) || 1);
  const db = await createSessionClient();
  const { data, count, error } = await db.from("audit_logs").select("*", { count: "exact" }).order("created_at", { ascending: false }).range((page - 1) * PER, page * PER - 1);
  const ids = [...new Set((data ?? []).map((a) => a.actor_id).filter(Boolean))];
  const { data: people } = ids.length ? await db.from("profiles").select("id,email,full_name").in("id", ids) : { data: [] };
  const who = (id: string | null) => (id ? people?.find((p) => p.id === id)?.email ?? id.slice(0, 8) : "System / public form");
  return (
    <>
      <div className="topbar"><div><h1>Activity log</h1><div className="sub">Recorded automatically by the database. Entries shown depend on your role.</div></div></div>
      {error ? <div className="flash err">{error.message}</div> : null}
      <section className="panel tight">
        <table className="data">
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Item</th><th>Details</th></tr></thead>
          <tbody>
            {(data ?? []).length === 0 ? <tr><td colSpan={5} className="empty">No activity.</td></tr> : null}
            {(data ?? []).map((a) => (
              <tr key={a.id}><td className="small">{fmtDate(a.created_at)}</td><td className="small">{who(a.actor_id)}</td><td><span className="pill">{a.action}</span></td><td>{a.entity_type.replace(/_/g, " ")}</td><td className="small muted">{a.summary ?? ""}</td></tr>
            ))}
          </tbody>
        </table>
        <div className="btn-row" style={{ padding: 14 }}>
          {page > 1 ? <Link className="btn secondary small" href={`?page=${page - 1}`}>← Newer</Link> : null}
          {(count ?? 0) > page * PER ? <Link className="btn secondary small" href={`?page=${page + 1}`}>Older →</Link> : null}
        </div>
      </section>
    </>
  );
}
