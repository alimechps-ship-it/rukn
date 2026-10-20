import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { InstantAction } from "@/components/admin/InstantAction";
import { Check, Select, StatusPill, Text, TextArea } from "@/components/admin/fields";
import { LocaleTabs } from "@/components/admin/LocaleTabs";
import { MediaPicker } from "@/components/admin/MediaPicker";
import { can, requireStaff } from "@/lib/auth";
import { allLanguages, createSessionClient, fmtDate, hasPendingChanges, PAGE_TR_FIELDS, pickerMedia, SECTION_TR_FIELDS } from "@/lib/admin";
import { createSection, move, savePage, setPageStatus, setSectionStatus, trash } from "../../_actions/content";

export const metadata = { title: "Edit page" };

const TYPES = ["hero", "rich_text", "image_text", "cards", "benefits", "steps", "services_grid", "gallery", "faq", "team", "cta", "notice", "contact_details", "inquiry_form"];

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireStaff(can.translate);
  const db = await createSessionClient();
  const [{ data: page }, langs, media] = await Promise.all([
    db.from("pages").select("*, page_translations(*), content_sections(id,key,type,status,sort_order,deleted_at,updated_at,content_section_translations(*))").eq("id", id).maybeSingle(),
    allLanguages(db),
    pickerMedia(db),
  ]);
  if (!page || page.deleted_at) notFound();
  const canEdit = can.content(user);
  const sections = (page.content_sections as { id: string; key: string; type: string; status: string; sort_order: number; deleted_at: string | null; updated_at: string; content_section_translations: Record<string, unknown>[] }[])
    .filter((s) => !s.deleted_at)
    .sort((a, b) => a.sort_order - b.sort_order);
  const trs = page.page_translations as Record<string, string | null>[];
  const draft = (code: string) => trs.find((t) => t.locale === code && t.variant === "draft");
  const pending = page.status === "published" && hasPendingChanges(trs, PAGE_TR_FIELDS);
  const def = langs.find((l) => l.is_default)?.code ?? "en";
  const publicPath = `/${def}${page.slug ? `/${page.slug}` : ""}`;

  return (
    <>
      <div className="topbar">
        <div>
          <div className="small"><Link href="/admin/pages">← Pages</Link></div>
          <h1>{draft(def)?.title ?? page.key}</h1>
          <div className="sub"><StatusPill status={page.status} pending={pending} /> <span className="mono">{publicPath}</span> · updated {fmtDate(page.updated_at)}</div>
        </div>
        <div className="btn-row">
          <a className="btn secondary" href={`/api/preview?path=${encodeURIComponent(publicPath)}`} target="_blank" rel="noopener">Preview drafts ↗</a>
          {page.status === "published" ? <a className="btn secondary" href={publicPath} target="_blank" rel="noopener">View live ↗</a> : null}
          {canEdit ? (
            <ConfirmAction action={setPageStatus} hidden={{ id: page.id, status: page.status === "published" ? "draft" : "published" }} small={false}
              label={page.status === "published" ? "Unpublish page" : "Publish page"} title={page.status === "published" ? "Unpublish this page?" : "Publish this page?"}
              message={page.status === "published" ? "Visitors will get a “page not found” response." : "Publishing makes the page title/SEO public. Sections are published individually."} />
          ) : null}
        </div>
      </div>

      <section className="panel">
        <div className="panel-head"><h2>Sections</h2><span className="muted small">Sections appear on the page in this order.</span></div>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>#</th><th>Section</th><th>Type</th><th>Status</th><th /></tr></thead>
            <tbody>
              {sections.map((s, i) => {
                const head = (s.content_section_translations.find((t) => t.locale === def && t.variant === "draft")?.heading as string) ?? s.key;
                const changes = s.status === "published" && hasPendingChanges(s.content_section_translations, SECTION_TR_FIELDS);
                return (
                  <tr key={s.id}>
                    <td className="muted">{i + 1}</td>
                    <td><Link href={`/admin/sections/${s.id}`}><strong>{head}</strong></Link><div className="small muted mono">{s.key}</div></td>
                    <td><span className="pill">{s.type}</span></td>
                    <td><StatusPill status={s.status} pending={changes} /></td>
                    <td className="actions">
                      <div className="btn-row" style={{ justifyContent: "flex-end" }}>
                        <Link className="btn secondary small" href={`/admin/sections/${s.id}`}>Edit</Link>
                        {canEdit ? (
                          <>
                            <InstantAction action={move} hidden={{ table: "content_sections", id: s.id, dir: "up", scope: "page_id", scopeVal: page.id }} title="Move up">↑</InstantAction>
                            <InstantAction action={move} hidden={{ table: "content_sections", id: s.id, dir: "down", scope: "page_id", scopeVal: page.id }} title="Move down">↓</InstantAction>
                            <ConfirmAction action={setSectionStatus} hidden={{ id: s.id, status: s.status === "published" ? "draft" : "published" }}
                              label={s.status === "published" ? (changes ? "Publish changes" : "Unpublish") : "Publish"}
                              title={s.status === "published" && !changes ? "Unpublish section?" : "Publish section?"}
                              message={s.status === "published" && !changes ? "The section will be hidden from the public page." : "The current draft (all languages) becomes public."} />
                            <ConfirmAction action={trash} hidden={{ table: "content_sections", id: s.id }} danger label="Delete" title="Move section to Trash?" message="It disappears from the page immediately and can be restored from the Trash." confirmLabel="Move to Trash" />
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {canEdit ? (
          <ActionForm action={createSection.bind(null, page.id)} className="form-grid" >
            <Text name="heading" label="New section heading" maxLength={200} />
            <Select name="type" label="Section type" defaultValue="rich_text" options={TYPES.map((t) => ({ value: t, label: t.replace("_", " ") }))} />
            <div className="full"><SubmitButton className="btn secondary">+ Add section</SubmitButton></div>
          </ActionForm>
        ) : null}
      </section>

      <section className="panel">
        <h2>Page title, URL & SEO</h2>
        <ActionForm action={savePage.bind(null, page.id)}>
          <input type="hidden" name="is_home" value={page.key === "home" ? "1" : "0"} />
          <input type="hidden" name="current_slug" value={page.slug} />
          <div className="form-grid">
            {page.key !== "home" ? <Text name="slug" label="URL slug" defaultValue={page.slug} disabled={!canEdit} maxLength={80} /> : <div className="field"><label>URL</label><div className="mono">/{"{locale}"} (home page)</div></div>}
            <Select name="template" label="Template" defaultValue={page.template} disabled options={[{ value: page.template, label: page.template }]} />
            <Check name="show_in_sitemap" label="Include in XML sitemap" defaultChecked={page.show_in_sitemap} disabled={!canEdit} />
            <Check name="needs_legal_review" label="Show “legal review required” banner" defaultChecked={page.needs_legal_review} disabled={!canEdit} />
            <div className="field full"><label>Social share image (Open Graph)</label><MediaPicker name="og_image_media_id" media={media} value={page.og_image_media_id} disabled={!canEdit} /></div>
          </div>
          <LocaleTabs panels={langs.map((l) => {
            const t = draft(l.code);
            const locked = !can.locale(user, l.code);
            return {
              code: l.code, label: l.native_name, locked, missing: !t,
              content: (
                <div className="form-grid">
                  <Text name={`tr.${l.code}.title`} label="Page title" defaultValue={t?.title} dir={l.dir} disabled={locked} maxLength={160} />
                  <Text name={`tr.${l.code}.seo_title`} label="SEO title" defaultValue={t?.seo_title} dir={l.dir} disabled={locked} maxLength={120} hint="Shown in search results and browser tabs (≈60 characters)." />
                  <TextArea name={`tr.${l.code}.seo_description`} label="SEO description" defaultValue={t?.seo_description} dir={l.dir} disabled={locked} maxLength={320} rows={2} hint="≈155 characters." />
                </div>
              ),
            };
          })} />
          <div className="btn-row" style={{ marginTop: 14 }}>
            <SubmitButton className="btn secondary" name="intent" value="draft">Save draft</SubmitButton>
            {canEdit ? <SubmitButton className="btn teal" name="intent" value="publish">Save & publish</SubmitButton> : null}
          </div>
        </ActionForm>
      </section>
    </>
  );
}
