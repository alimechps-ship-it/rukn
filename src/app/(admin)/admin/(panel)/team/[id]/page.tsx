import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { Select, Text, TextArea } from "@/components/admin/fields";
import { LocaleTabs } from "@/components/admin/LocaleTabs";
import { MediaPicker } from "@/components/admin/MediaPicker";
import { can, requireStaff } from "@/lib/auth";
import { allLanguages, createSessionClient, pickerMedia } from "@/lib/admin";
import { saveTeamMember } from "../../_actions/simple";

export const metadata = { title: "Edit team profile" };
const STATUS = [{ value: "draft", label: "Draft (hidden)" }, { value: "published", label: "Published" }, { value: "archived", label: "Archived" }];

export default async function EditMember({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireStaff(can.translate);
  const db = await createSessionClient();
  const [{ data: m }, langs, media] = await Promise.all([db.from("team_members").select("*, team_member_translations(*)").eq("id", id).maybeSingle(), allLanguages(db), pickerMedia(db)]);
  if (!m || m.deleted_at) notFound();
  const canEdit = can.content(user);
  return (
    <>
      <div className="topbar"><div><div className="small"><Link href="/admin/team">← Team</Link></div><h1>Edit team profile</h1></div></div>
      <ActionForm action={saveTeamMember.bind(null, m.id)}>
        <section className="panel">
          <div className="form-grid">
            <Select name="status" label="Status" defaultValue={m.status} options={STATUS} disabled={!canEdit} />
            <Text name="linkedin_url" label="LinkedIn URL (optional)" defaultValue={m.linkedin_url} disabled={!canEdit} />
            <div className="field full"><label>Photo</label><MediaPicker name="photo_media_id" media={media} value={m.photo_media_id} disabled={!canEdit} /></div>
          </div>
        </section>
        <section className="panel">
          <LocaleTabs panels={langs.map((l) => {
            const t = (m.team_member_translations as Record<string, string>[]).find((x) => x.locale === l.code);
            const locked = !can.locale(user, l.code);
            return {
              code: l.code, label: l.native_name, locked, missing: !t,
              content: (
                <div className="form-grid">
                  <input type="hidden" name={`tr.${l.code}.present`} value="1" disabled={locked} />
                  <Text name={`tr.${l.code}.name`} label="Name" defaultValue={t?.name} dir={l.dir} disabled={locked} maxLength={120} />
                  <Text name={`tr.${l.code}.role_title`} label="Role / title" defaultValue={t?.role_title} dir={l.dir} disabled={locked} maxLength={120} />
                  <TextArea name={`tr.${l.code}.bio`} label="Short bio" defaultValue={t?.bio} dir={l.dir} disabled={locked} maxLength={1500} />
                </div>
              ),
            };
          })} />
        </section>
        <SubmitButton>Save</SubmitButton>
      </ActionForm>
    </>
  );
}
