import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { Select, StatusPill, Text } from "@/components/admin/fields";
import { can, requireStaff } from "@/lib/auth";
import { createSessionClient, fmtDate } from "@/lib/admin";
import { createPage, setPageStatus, trash } from "../_actions/content";

export const metadata = { title: "Pages" };

export default async function PagesList() {
  const user = await requireStaff(can.translate);
  const db = await createSessionClient();
  const { data: pages, error } = await db
    .from("pages")
    .select("id,key,slug,template,status,needs_legal_review,updated_at,page_translations(locale,variant,title),content_sections(id,deleted_at)")
    .is("deleted_at", null)
    .order("sort_order");
  const canEdit = can.content(user);

  return (
    <>
      <div className="topbar"><div><h1>Pages & sections</h1><div className="sub">Every page is built from ordered sections. Edit drafts, preview, then publish.</div></div></div>
      {error ? <div className="flash err">Could not load pages: {error.message}</div> : null}
      <section className="panel tight">
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Page</th><th>URL</th><th>Status</th><th>Sections</th><th>Updated</th><th /></tr></thead>
            <tbody>
              {(pages ?? []).map((p) => {
                const title = p.page_translations.find((t) => t.variant === "draft" && t.locale === "en")?.title ?? p.page_translations[0]?.title ?? p.key;
                return (
                  <tr key={p.id}>
                    <td><Link href={`/admin/pages/${p.id}`}><strong>{title}</strong></Link>{p.needs_legal_review ? <div><span className="pill draft">legal review required</span></div> : null}</td>
                    <td className="mono">/{"{locale}"}/{p.slug}</td>
                    <td><StatusPill status={p.status} /></td>
                    <td>{p.content_sections.filter((s) => !s.deleted_at).length}</td>
                    <td className="small muted">{fmtDate(p.updated_at)}</td>
                    <td className="actions">
                      <div className="btn-row" style={{ justifyContent: "flex-end" }}>
                        <Link className="btn secondary small" href={`/admin/pages/${p.id}`}>Edit</Link>
                        {canEdit ? (
                          <ConfirmAction action={setPageStatus} hidden={{ id: p.id, status: p.status === "published" ? "draft" : "published" }}
                            label={p.status === "published" ? "Unpublish" : "Publish"} title={p.status === "published" ? "Unpublish page?" : "Publish page?"}
                            message={p.status === "published" ? "The page will no longer be visible on the public website." : "The page and its published sections will become visible on the public website."} />
                        ) : null}
                        {canEdit && p.key !== "home" ? (
                          <ConfirmAction action={trash} hidden={{ table: "pages", id: p.id }} danger label="Delete" title="Move page to Trash?" message="The page disappears from the website immediately. You can restore it from the Trash." confirmLabel="Move to Trash" />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      {canEdit ? (
        <section className="panel">
          <h2>Create a page</h2>
          <ActionForm action={createPage} className="form-grid">
            <Text name="title" label="Title (default language)" required maxLength={160} />
            <Text name="slug" label="URL slug" hint="Lowercase letters, numbers and dashes, e.g. lab-services" maxLength={80} />
            <Select name="template" label="Template" defaultValue="standard" options={["standard", "legal", "contact", "partnerships", "about", "case"].map((v) => ({ value: v, label: v }))} />
            <div className="full"><SubmitButton>Create draft page</SubmitButton></div>
          </ActionForm>
        </section>
      ) : null}
    </>
  );
}
