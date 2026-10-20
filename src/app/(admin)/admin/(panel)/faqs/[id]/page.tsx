import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { RICH_HINT, Select, Text, TextArea } from "@/components/admin/fields";
import { LocaleTabs } from "@/components/admin/LocaleTabs";
import { can, requireStaff } from "@/lib/auth";
import { allLanguages, createSessionClient } from "@/lib/admin";
import { saveFaq } from "../../_actions/simple";

export const metadata = { title: "Edit FAQ" };
const STATUS = [{ value: "draft", label: "Draft (hidden)" }, { value: "published", label: "Published" }, { value: "archived", label: "Archived" }];

export default async function EditFaq({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireStaff(can.translate);
  const db = await createSessionClient();
  const [{ data: f }, langs] = await Promise.all([db.from("faqs").select("*, faq_translations(*)").eq("id", id).maybeSingle(), allLanguages(db)]);
  if (!f || f.deleted_at) notFound();
  const canEdit = can.content(user);
  return (
    <>
      <div className="topbar"><div><div className="small"><Link href="/admin/faqs">← FAQs</Link></div><h1>Edit FAQ</h1></div></div>
      <ActionForm action={saveFaq.bind(null, f.id)}>
        <section className="panel">
          <div className="form-grid">
            <Select name="status" label="Status" defaultValue={f.status} options={STATUS} disabled={!canEdit} />
            <Text name="topic" label="Topic" defaultValue={f.topic} disabled={!canEdit} />
          </div>
        </section>
        <section className="panel">
          <LocaleTabs panels={langs.map((l) => {
            const t = (f.faq_translations as Record<string, string>[]).find((x) => x.locale === l.code);
            const locked = !can.locale(user, l.code);
            return {
              code: l.code, label: l.native_name, locked, missing: !t,
              content: (
                <div className="form-grid">
                  <input type="hidden" name={`tr.${l.code}.present`} value="1" disabled={locked} />
                  <Text name={`tr.${l.code}.question`} label="Question" defaultValue={t?.question} dir={l.dir} disabled={locked} maxLength={300} full />
                  <TextArea name={`tr.${l.code}.answer`} label="Answer" defaultValue={t?.answer} dir={l.dir} disabled={locked} maxLength={3000} rows={6} hint={RICH_HINT} />
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
