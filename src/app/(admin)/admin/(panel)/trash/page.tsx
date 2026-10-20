import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { can, requireStaff } from "@/lib/auth";
import { createSessionClient, fmtDate } from "@/lib/admin";
import { destroy, restore } from "../_actions/content";

export const metadata = { title: "Trash" };

export default async function Trash() {
  await requireStaff(can.content);
  const db = await createSessionClient();
  const [pages, sections, services, faqs, team, ann] = await Promise.all([
    db.from("pages").select("id,key,deleted_at").not("deleted_at", "is", null),
    db.from("content_sections").select("id,key,type,deleted_at,pages(key)").not("deleted_at", "is", null),
    db.from("services").select("id,slug,deleted_at").not("deleted_at", "is", null),
    db.from("faqs").select("id,deleted_at,faq_translations(locale,question)").not("deleted_at", "is", null),
    db.from("team_members").select("id,deleted_at,team_member_translations(locale,name)").not("deleted_at", "is", null),
    db.from("announcements").select("id,deleted_at,announcement_translations(locale,text)").not("deleted_at", "is", null),
  ]);
  const items = [
    ...(pages.data ?? []).map((x) => ({ table: "pages", id: x.id, kind: "Page", label: x.key, at: x.deleted_at })),
    ...(sections.data ?? []).map((x) => ({ table: "content_sections", id: x.id, kind: "Section", label: `${(x.pages as unknown as { key: string } | null)?.key ?? "?"} / ${x.key} (${x.type})`, at: x.deleted_at })),
    ...(services.data ?? []).map((x) => ({ table: "services", id: x.id, kind: "Service", label: x.slug, at: x.deleted_at })),
    ...(faqs.data ?? []).map((x) => ({ table: "faqs", id: x.id, kind: "FAQ", label: x.faq_translations[0]?.question ?? "FAQ", at: x.deleted_at })),
    ...(team.data ?? []).map((x) => ({ table: "team_members", id: x.id, kind: "Team profile", label: x.team_member_translations[0]?.name ?? "Profile", at: x.deleted_at })),
    ...(ann.data ?? []).map((x) => ({ table: "announcements", id: x.id, kind: "Announcement", label: x.announcement_translations[0]?.text ?? "Announcement", at: x.deleted_at })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return (
    <>
      <div className="topbar"><div><h1>Trash</h1><div className="sub">Deleted content can be restored here. Permanent deletion cannot be undone.</div></div></div>
      <section className="panel tight">
        <table className="data">
          <thead><tr><th>Type</th><th>Item</th><th>Deleted</th><th /></tr></thead>
          <tbody>
            {items.length === 0 ? <tr><td colSpan={4} className="empty">Trash is empty.</td></tr> : null}
            {items.map((i) => (
              <tr key={`${i.table}-${i.id}`}>
                <td><span className="pill">{i.kind}</span></td>
                <td>{i.label}</td>
                <td className="small muted">{fmtDate(i.at)}</td>
                <td className="actions"><div className="btn-row" style={{ justifyContent: "flex-end" }}>
                  <ConfirmAction action={restore} hidden={{ table: i.table, id: i.id }} label="Restore" title="Restore item?" message="It returns with the status it had before (published items become visible again)." confirmLabel="Restore" />
                  <ConfirmAction action={destroy} hidden={{ table: i.table, id: i.id }} danger label="Delete permanently" title="Delete permanently?" message="This removes the item and all its translations for good." confirmLabel="Delete permanently" />
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
