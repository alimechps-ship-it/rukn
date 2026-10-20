import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { InstantAction } from "@/components/admin/InstantAction";
import { StatusPill, Text, TextArea } from "@/components/admin/fields";
import { can, requireStaff } from "@/lib/auth";
import { allLanguages, createSessionClient } from "@/lib/admin";
import { move, setStatus, trash } from "../_actions/content";
import { createFaq } from "../_actions/simple";

export const metadata = { title: "FAQs" };

export default async function Faqs() {
  const user = await requireStaff(can.translate);
  const db = await createSessionClient();
  const [{ data, error }, langs] = await Promise.all([
    db.from("faqs").select("id,topic,status,sort_order,faq_translations(locale,question)").is("deleted_at", null).order("sort_order"),
    allLanguages(db),
  ]);
  const canEdit = can.content(user);
  return (
    <>
      <div className="topbar"><div><h1>FAQs</h1><div className="sub">Published FAQs appear in FAQ sections with the matching topic.</div></div></div>
      {error ? <div className="flash err">{error.message}</div> : null}
      <section className="panel tight">
        <table className="data">
          <thead><tr><th>Question</th><th>Topic</th><th>Languages</th><th>Status</th><th /></tr></thead>
          <tbody>
            {(data ?? []).length === 0 ? <tr><td colSpan={5} className="empty">No FAQs yet.</td></tr> : null}
            {(data ?? []).map((f) => (
              <tr key={f.id}>
                <td><Link href={`/admin/faqs/${f.id}`}>{f.faq_translations.find((t) => t.locale === "en")?.question ?? f.faq_translations[0]?.question ?? "(untitled)"}</Link></td>
                <td className="mono">{f.topic}</td>
                <td className="small">{langs.map((l) => (f.faq_translations.some((t) => t.locale === l.code) ? l.code.toUpperCase() : null)).filter(Boolean).join(" · ")}</td>
                <td><StatusPill status={f.status} /></td>
                <td className="actions"><div className="btn-row" style={{ justifyContent: "flex-end" }}>
                  <Link className="btn secondary small" href={`/admin/faqs/${f.id}`}>Edit</Link>
                  {canEdit ? (<>
                    <InstantAction action={move} hidden={{ table: "faqs", id: f.id, dir: "up" }} title="Move up">↑</InstantAction>
                    <InstantAction action={move} hidden={{ table: "faqs", id: f.id, dir: "down" }} title="Move down">↓</InstantAction>
                    <ConfirmAction action={setStatus} hidden={{ table: "faqs", id: f.id, status: f.status === "published" ? "draft" : "published" }} label={f.status === "published" ? "Unpublish" : "Publish"} title={f.status === "published" ? "Unpublish FAQ?" : "Publish FAQ?"} message="This changes what visitors see immediately." />
                    <ConfirmAction action={trash} hidden={{ table: "faqs", id: f.id }} danger label="Delete" title="Move FAQ to Trash?" message="It can be restored from the Trash." confirmLabel="Move to Trash" />
                  </>) : null}
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {canEdit ? (
        <section className="panel">
          <h2>Add a FAQ</h2>
          <ActionForm action={createFaq} className="form-grid">
            <Text name="question" label="Question (default language)" required maxLength={300} full />
            <TextArea name="answer" label="Answer" required maxLength={3000} />
            <Text name="topic" label="Topic" defaultValue="general" />
            <div className="full"><SubmitButton>Create draft FAQ</SubmitButton></div>
          </ActionForm>
        </section>
      ) : null}
    </>
  );
}
