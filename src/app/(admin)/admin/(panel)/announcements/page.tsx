import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { StatusPill, Text } from "@/components/admin/fields";
import { can, requireStaff } from "@/lib/auth";
import { createSessionClient, fmtDate } from "@/lib/admin";
import { setStatus, trash } from "../_actions/content";
import { createAnnouncement } from "../_actions/simple";

export const metadata = { title: "Announcements" };

export default async function Announcements() {
  const user = await requireStaff(can.translate);
  const db = await createSessionClient();
  const { data, error } = await db.from("announcements").select("id,status,starts_at,ends_at,announcement_translations(locale,text)").is("deleted_at", null).order("sort_order");
  const canEdit = can.content(user);
  return (
    <>
      <div className="topbar"><div><h1>Announcements</h1><div className="sub">A thin bar above the header on every page, optionally limited to a date range.</div></div></div>
      {error ? <div className="flash err">{error.message}</div> : null}
      <section className="panel tight">
        <table className="data">
          <thead><tr><th>Text</th><th>Window</th><th>Status</th><th /></tr></thead>
          <tbody>
            {(data ?? []).length === 0 ? <tr><td colSpan={4} className="empty">No announcements.</td></tr> : null}
            {(data ?? []).map((a) => (
              <tr key={a.id}>
                <td><Link href={`/admin/announcements/${a.id}`}>{a.announcement_translations.find((t) => t.locale === "en")?.text ?? a.announcement_translations[0]?.text}</Link></td>
                <td className="small">{a.starts_at ? fmtDate(a.starts_at) : "Any time"} → {a.ends_at ? fmtDate(a.ends_at) : "no end"}</td>
                <td><StatusPill status={a.status} /></td>
                <td className="actions"><div className="btn-row" style={{ justifyContent: "flex-end" }}>
                  <Link className="btn secondary small" href={`/admin/announcements/${a.id}`}>Edit</Link>
                  {canEdit ? (<>
                    <ConfirmAction action={setStatus} hidden={{ table: "announcements", id: a.id, status: a.status === "published" ? "draft" : "published" }} label={a.status === "published" ? "Unpublish" : "Publish"} title="Change visibility?" message="This changes what visitors see immediately." />
                    <ConfirmAction action={trash} hidden={{ table: "announcements", id: a.id }} danger label="Delete" title="Move to Trash?" message="It can be restored from the Trash." confirmLabel="Move to Trash" />
                  </>) : null}
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {canEdit ? (
        <section className="panel">
          <h2>New announcement</h2>
          <ActionForm action={createAnnouncement} className="form-grid">
            <Text name="text" label="Text (default language)" required maxLength={300} full />
            <div className="full"><SubmitButton>Create draft</SubmitButton></div>
          </ActionForm>
        </section>
      ) : null}
    </>
  );
}
