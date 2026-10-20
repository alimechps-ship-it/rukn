import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { Select, Text } from "@/components/admin/fields";
import { LocaleTabs } from "@/components/admin/LocaleTabs";
import { can, requireStaff } from "@/lib/auth";
import { allLanguages, createSessionClient } from "@/lib/admin";
import { saveAnnouncement } from "../../_actions/simple";

export const metadata = { title: "Edit announcement" };
const STATUS = [{ value: "draft", label: "Draft (hidden)" }, { value: "published", label: "Published" }, { value: "archived", label: "Archived" }];
const local = (v: string | null) => (v ? new Date(v).toISOString().slice(0, 16) : "");

export default async function EditAnnouncement({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireStaff(can.translate);
  const db = await createSessionClient();
  const [{ data: a }, langs] = await Promise.all([db.from("announcements").select("*, announcement_translations(*)").eq("id", id).maybeSingle(), allLanguages(db)]);
  if (!a || a.deleted_at) notFound();
  const canEdit = can.content(user);
  return (
    <>
      <div className="topbar"><div><div className="small"><Link href="/admin/announcements">← Announcements</Link></div><h1>Edit announcement</h1></div></div>
      <ActionForm action={saveAnnouncement.bind(null, a.id)}>
        <section className="panel">
          <div className="form-grid">
            <Select name="status" label="Status" defaultValue={a.status} options={STATUS} disabled={!canEdit} />
            <Text name="href" label="Link (optional)" defaultValue={a.href} disabled={!canEdit} hint="/path or https://…" />
            <Text name="starts_at" label="Show from (UTC)" type="datetime-local" defaultValue={local(a.starts_at)} disabled={!canEdit} />
            <Text name="ends_at" label="Show until (UTC)" type="datetime-local" defaultValue={local(a.ends_at)} disabled={!canEdit} />
          </div>
        </section>
        <section className="panel">
          <LocaleTabs panels={langs.map((l) => {
            const t = (a.announcement_translations as Record<string, string>[]).find((x) => x.locale === l.code);
            const locked = !can.locale(user, l.code);
            return {
              code: l.code, label: l.native_name, locked, missing: !t,
              content: (
                <div className="form-grid">
                  <input type="hidden" name={`tr.${l.code}.present`} value="1" disabled={locked} />
                  <Text name={`tr.${l.code}.text`} label="Text" defaultValue={t?.text} dir={l.dir} disabled={locked} maxLength={300} full />
                  <Text name={`tr.${l.code}.link_label`} label="Link label" defaultValue={t?.link_label} dir={l.dir} disabled={locked} maxLength={60} />
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
