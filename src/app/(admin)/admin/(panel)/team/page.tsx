import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { InstantAction } from "@/components/admin/InstantAction";
import { StatusPill, Text } from "@/components/admin/fields";
import { can, requireStaff } from "@/lib/auth";
import { createSessionClient } from "@/lib/admin";
import { move, trash } from "../_actions/content";
import { createTeamMember } from "../_actions/simple";

export const metadata = { title: "Team profiles" };

export default async function Team() {
  const user = await requireStaff(can.translate);
  const db = await createSessionClient();
  const { data, error } = await db.from("team_members").select("id,status,sort_order,team_member_translations(locale,name,role_title)").is("deleted_at", null).order("sort_order");
  const canEdit = can.content(user);
  return (
    <>
      <div className="topbar"><div><h1>Team profiles</h1><div className="sub">Only add real people with their consent. Names and credentials are never generated automatically.</div></div></div>
      {error ? <div className="flash err">{error.message}</div> : null}
      <section className="panel tight">
        <table className="data">
          <thead><tr><th>Name</th><th>Role</th><th>Status</th><th /></tr></thead>
          <tbody>
            {(data ?? []).length === 0 ? <tr><td colSpan={4} className="empty">No team profiles yet. The About page shows a neutral message until profiles are published.</td></tr> : null}
            {(data ?? []).map((m) => {
              const t = m.team_member_translations.find((x) => x.locale === "en") ?? m.team_member_translations[0];
              return (
                <tr key={m.id}>
                  <td><Link href={`/admin/team/${m.id}`}>{t?.name ?? "(unnamed)"}</Link></td>
                  <td>{t?.role_title ?? "—"}</td>
                  <td><StatusPill status={m.status} /></td>
                  <td className="actions"><div className="btn-row" style={{ justifyContent: "flex-end" }}>
                    <Link className="btn secondary small" href={`/admin/team/${m.id}`}>Edit</Link>
                    {canEdit ? (<>
                      <InstantAction action={move} hidden={{ table: "team_members", id: m.id, dir: "up" }} title="Move up">↑</InstantAction>
                      <InstantAction action={move} hidden={{ table: "team_members", id: m.id, dir: "down" }} title="Move down">↓</InstantAction>
                      <ConfirmAction action={trash} hidden={{ table: "team_members", id: m.id }} danger label="Remove" title="Remove team profile?" message="The profile disappears from the website. It can be restored from the Trash." confirmLabel="Move to Trash" />
                    </>) : null}
                  </div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      {canEdit ? (
        <section className="panel">
          <h2>Add a team profile</h2>
          <ActionForm action={createTeamMember} className="form-grid">
            <Text name="name" label="Full name (default language)" required maxLength={120} />
            <div className="full"><SubmitButton>Create draft profile</SubmitButton></div>
          </ActionForm>
        </section>
      ) : null}
    </>
  );
}
