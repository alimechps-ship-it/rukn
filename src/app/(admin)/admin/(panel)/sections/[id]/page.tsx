import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { Check, RICH_HINT, Select, StatusPill, Text, TextArea } from "@/components/admin/fields";
import { ItemsEditor } from "@/components/admin/ItemsEditor";
import { LocaleTabs } from "@/components/admin/LocaleTabs";
import { MediaPicker } from "@/components/admin/MediaPicker";
import { can, requireStaff } from "@/lib/auth";
import { allLanguages, createSessionClient, fmtDate, hasPendingChanges, pickerMedia, SECTION_TR_FIELDS } from "@/lib/admin";
import { discardDraft, saveSection } from "../../_actions/content";

export const metadata = { title: "Edit section" };

type F = "eyebrow" | "heading" | "subheading" | "body" | "items" | "primary" | "secondary";
const FIELDS: Record<string, F[]> = {
  hero: ["eyebrow", "heading", "subheading", "body", "primary", "secondary"],
  rich_text: ["eyebrow", "heading", "body", "primary", "secondary"],
  image_text: ["eyebrow", "heading", "body", "primary"],
  cards: ["eyebrow", "heading", "subheading", "items", "primary", "secondary"],
  benefits: ["eyebrow", "heading", "subheading", "items", "primary", "secondary"],
  steps: ["eyebrow", "heading", "subheading", "items"],
  services_grid: ["eyebrow", "heading", "subheading", "primary"],
  gallery: ["eyebrow", "heading", "subheading"],
  faq: ["eyebrow", "heading", "subheading"],
  team: ["eyebrow", "heading", "subheading", "body"],
  cta: ["eyebrow", "heading", "body", "primary", "secondary"],
  notice: ["heading", "body"],
  contact_details: ["heading"],
  inquiry_form: ["heading", "body"],
};
const USES_MEDIA = ["hero", "image_text"];

export default async function EditSection({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireStaff(can.translate);
  const db = await createSessionClient();
  const [{ data: s }, langs, media] = await Promise.all([
    db.from("content_sections").select("*, content_section_translations(*), pages(id,key,slug)").eq("id", id).maybeSingle(),
    allLanguages(db),
    pickerMedia(db),
  ]);
  if (!s || s.deleted_at) notFound();
  const canEdit = can.content(user);
  const trs = s.content_section_translations as Record<string, unknown>[];
  const draft = (code: string) => trs.find((t) => t.locale === code && t.variant === "draft") as Record<string, string | null> & { items?: { title: string; text: string }[] } | undefined;
  const pending = s.status === "published" && hasPendingChanges(trs, SECTION_TR_FIELDS);
  const page = s.pages as { id: string; key: string; slug: string };
  const def = langs.find((l) => l.is_default)?.code ?? "en";
  const fields = FIELDS[s.type] ?? ["eyebrow", "heading", "body"];
  const settings = (s.settings ?? {}) as Record<string, unknown>;
  const has = (f: F) => fields.includes(f);

  return (
    <>
      <div className="topbar">
        <div>
          <div className="small"><Link href={`/admin/pages/${page.id}`}>← Page: {page.key}</Link></div>
          <h1>{draft(def)?.heading ?? s.key}</h1>
          <div className="sub"><span className="pill">{s.type}</span> <StatusPill status={s.status} pending={pending} /> · updated {fmtDate(s.updated_at)}</div>
        </div>
        <div className="btn-row">
          {langs.map((l) => (
            <a key={l.code} className="btn secondary small" target="_blank" rel="noopener" href={`/api/preview?path=${encodeURIComponent(`/${l.code}${page.slug ? `/${page.slug}` : ""}`)}`}>Preview {l.code.toUpperCase()} ↗</a>
          ))}
          {canEdit && pending ? (
            <ConfirmAction action={discardDraft} hidden={{ id: s.id, kind: "section" }} danger label="Discard draft changes" title="Discard draft changes?" message="All unpublished edits in every language will be replaced by the currently published version." confirmLabel="Discard" />
          ) : null}
        </div>
      </div>

      <ActionForm action={saveSection.bind(null, s.id)}>
        {canEdit ? (
          <section className="panel">
            <h2>Section settings</h2>
            <div className="form-grid">
              <Text name="key" label="Internal key" defaultValue={s.key} maxLength={60} hint="Used by the system; not shown to visitors." />
              {s.type === "inquiry_form" ? (
                <Select name="settings.form" label="Form type" defaultValue={String(settings.form ?? "contact")} options={[{ value: "contact", label: "General contact" }, { value: "case", label: "Case inquiry" }, { value: "partnership", label: "Partnership inquiry" }]} />
              ) : null}
              {s.type === "rich_text" ? (
                <Select name="settings.layout" label="Layout" defaultValue={String(settings.layout ?? "full")} options={[{ value: "full", label: "Full width" }, { value: "split", label: "Heading left, text right" }]} />
              ) : null}
              {s.type === "faq" ? <Text name="settings.topic" label="FAQ topic" defaultValue={String(settings.topic ?? "general")} hint="Shows published FAQs with this topic." /> : null}
              {s.type === "services_grid" ? (<><input type="hidden" name="settings.featured_only_present" value="1" /><Check name="settings.featured_only" label="Show featured services only" defaultChecked={Boolean(settings.featured_only)} /></>) : null}
              {s.type === "hero" ? (<><input type="hidden" name="settings.compact_present" value="1" /><Check name="settings.compact" label="Compact page header (no image)" defaultChecked={Boolean(settings.compact)} /></>) : null}
              {USES_MEDIA.includes(s.type) ? (
                <div className="field full"><label>Image</label><MediaPicker name="media_id" media={media} value={s.media_id} /></div>
              ) : null}
              {s.type === "gallery" ? (
                <div className="field full"><label>Gallery images (in order)</label><MediaPicker name="settings.media_ids" media={media} multiple value={Array.isArray(settings.media_ids) ? (settings.media_ids as string[]) : []} /></div>
              ) : null}
            </div>
          </section>
        ) : null}

        <section className="panel">
          <h2>Content</h2>
          <LocaleTabs panels={langs.map((l) => {
            const t = draft(l.code);
            const locked = !can.locale(user, l.code);
            const n = (k: string) => `tr.${l.code}.${k}`;
            return {
              code: l.code, label: l.native_name, locked, missing: !t,
              content: (
                <div className="form-grid">
                  <input type="hidden" name={n("present")} value="1" disabled={locked} />
                  {has("eyebrow") ? <Text name={n("eyebrow")} label="Eyebrow (small label above heading)" defaultValue={t?.eyebrow} dir={l.dir} disabled={locked} maxLength={120} /> : null}
                  {has("heading") ? <Text name={n("heading")} label="Heading" defaultValue={t?.heading} dir={l.dir} disabled={locked} maxLength={200} /> : null}
                  {has("subheading") ? <TextArea name={n("subheading")} label="Supporting text" defaultValue={t?.subheading} dir={l.dir} disabled={locked} maxLength={400} rows={2} /> : null}
                  {has("body") ? <TextArea name={n("body")} label="Body text" defaultValue={t?.body} dir={l.dir} disabled={locked} rows={8} hint={RICH_HINT} /> : null}
                  {has("items") ? (
                    <div className="field full"><label>Items</label><ItemsEditor name={n("items")} initial={(t?.items ?? []).map((i) => ({ title: i.title ?? "", text: i.text ?? "" }))} dir={l.dir} disabled={locked} /></div>
                  ) : null}
                  {has("primary") ? (
                    <>
                      <Text name={n("primary_label")} label="Primary button label" defaultValue={t?.primary_label} dir={l.dir} disabled={locked} maxLength={80} />
                      <Text name={n("primary_href")} label="Primary button link" defaultValue={t?.primary_href} disabled={locked} maxLength={300} hint="Internal path like /case-inquiry (language is added automatically) or a full https:// URL." />
                    </>
                  ) : null}
                  {has("secondary") ? (
                    <>
                      <Text name={n("secondary_label")} label="Secondary button label" defaultValue={t?.secondary_label} dir={l.dir} disabled={locked} maxLength={80} />
                      <Text name={n("secondary_href")} label="Secondary button link" defaultValue={t?.secondary_href} disabled={locked} maxLength={300} />
                    </>
                  ) : null}
                </div>
              ),
            };
          })} />
        </section>
        <div className="btn-row">
          <SubmitButton className="btn secondary" name="intent" value="draft">Save draft</SubmitButton>
          {canEdit ? <SubmitButton className="btn teal" name="intent" value="publish" pendingText="Publishing…">Save & publish</SubmitButton> : <span className="small muted">Translators save drafts; a Content Manager publishes them.</span>}
        </div>
      </ActionForm>
    </>
  );
}
