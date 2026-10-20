import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { Check, RICH_HINT, StatusPill, Text, TextArea } from "@/components/admin/fields";
import { ItemsEditor } from "@/components/admin/ItemsEditor";
import { LocaleTabs } from "@/components/admin/LocaleTabs";
import { MediaPicker } from "@/components/admin/MediaPicker";
import { can, requireStaff } from "@/lib/auth";
import { allLanguages, createSessionClient, fmtDate, hasPendingChanges, pickerMedia, SERVICE_TR_FIELDS } from "@/lib/admin";
import { discardDraft } from "../../_actions/content";
import { saveService, setServiceStatus } from "../../_actions/services";

export const metadata = { title: "Edit service" };

export default async function EditService({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireStaff(can.translate);
  const db = await createSessionClient();
  const [{ data: s }, langs, media] = await Promise.all([
    db.from("services").select("*, service_translations(*), service_images(media_id,sort_order)").eq("id", id).maybeSingle(),
    allLanguages(db),
    pickerMedia(db),
  ]);
  if (!s || s.deleted_at) notFound();
  const canEdit = can.content(user);
  const trs = s.service_translations as Record<string, unknown>[];
  type Tr = Record<string, string | null> & { features?: string[]; workflow?: { title: string; text: string }[] };
  const draft = (code: string) => trs.find((t) => t.locale === code && t.variant === "draft") as Tr | undefined;
  const pending = s.status === "published" && hasPendingChanges(trs, SERVICE_TR_FIELDS);
  const def = langs.find((l) => l.is_default)?.code ?? "en";
  const gallery = (s.service_images as { media_id: string; sort_order: number }[]).sort((a, b) => a.sort_order - b.sort_order).map((g) => g.media_id);

  return (
    <>
      <div className="topbar">
        <div>
          <div className="small"><Link href="/admin/services">← Services</Link></div>
          <h1>{draft(def)?.nav_title ?? draft(def)?.title ?? s.slug}</h1>
          <div className="sub"><StatusPill status={s.status} pending={pending} /> <span className="mono">/services/{s.slug}</span> · updated {fmtDate(s.updated_at)}</div>
        </div>
        <div className="btn-row">
          {langs.map((l) => <a key={l.code} className="btn secondary small" target="_blank" rel="noopener" href={`/api/preview?path=${encodeURIComponent(`/${l.code}/services/${s.slug}`)}`}>Preview {l.code.toUpperCase()} ↗</a>)}
          {canEdit && s.status === "published" && !pending ? <ConfirmAction action={setServiceStatus} hidden={{ id: s.id, status: "draft" }} label="Unpublish" title="Unpublish service?" message="The service page and its cards disappear from the website." /> : null}
          {canEdit && pending ? <ConfirmAction action={discardDraft} hidden={{ id: s.id, kind: "service" }} danger label="Discard draft changes" title="Discard draft changes?" message="All unpublished text edits will be replaced by the published version." confirmLabel="Discard" /> : null}
        </div>
      </div>

      <ActionForm action={saveService.bind(null, s.id)}>
        {canEdit ? (
          <section className="panel">
            <h2>Service settings</h2>
            <div className="form-grid">
              <Text name="slug" label="URL slug" defaultValue={s.slug} required maxLength={80} />
              <Text name="sort_order" label="Display order" type="number" defaultValue={s.sort_order} />
              <Text name="cta_href" label="Call-to-action link" defaultValue={s.cta_href} hint="Default: /case-inquiry?service=<slug>" />
              <Check name="is_featured" label="Featured (shown on the home page)" defaultChecked={s.is_featured} />
              <div className="field full"><label>Main image</label><MediaPicker name="main_media_id" media={media} value={s.main_media_id} /></div>
              <div className="field full"><label>Gallery images (in order)</label><MediaPicker name="gallery" media={media} value={gallery} multiple /></div>
            </div>
            <h3 style={{ marginTop: 18 }}>Pricing</h3>
            <div className="form-grid">
              <Check name="show_price" label="Display a price on the website" defaultChecked={s.show_price} hint="Prices are never shown unless this is ticked and both fields are set." />
              <div />
              <Text name="price_amount" label="Starting price" type="number" defaultValue={s.price_amount} />
              <Text name="price_currency" label="Currency (ISO code)" defaultValue={s.price_currency} maxLength={3} placeholder="USD" />
            </div>
          </section>
        ) : null}

        <section className="panel">
          <h2>Texts</h2>
          <LocaleTabs panels={langs.map((l) => {
            const t = draft(l.code);
            const locked = !can.locale(user, l.code);
            const n = (k: string) => `tr.${l.code}.${k}`;
            return {
              code: l.code, label: l.native_name, locked, missing: !t,
              content: (
                <div className="form-grid">
                  <input type="hidden" name={n("present")} value="1" disabled={locked} />
                  <Text name={n("title")} label="Page headline" defaultValue={t?.title} dir={l.dir} disabled={locked} maxLength={160} />
                  <Text name={n("nav_title")} label="Short name (menus & cards)" defaultValue={t?.nav_title} dir={l.dir} disabled={locked} maxLength={80} />
                  <TextArea name={n("summary")} label="Card summary" defaultValue={t?.summary} dir={l.dir} disabled={locked} maxLength={400} rows={2} />
                  <TextArea name={n("description")} label="Description" defaultValue={t?.description} dir={l.dir} disabled={locked} maxLength={4000} rows={5} hint={RICH_HINT} />
                  <Text name={n("features_heading")} label="Features heading" defaultValue={t?.features_heading} dir={l.dir} disabled={locked} maxLength={160} />
                  <TextArea name={n("features")} label="Features (one per line)" defaultValue={(t?.features ?? []).join("\n")} dir={l.dir} disabled={locked} rows={6} />
                  <Text name={n("workflow_heading")} label="Workflow heading" defaultValue={t?.workflow_heading} dir={l.dir} disabled={locked} maxLength={160} full />
                  <div className="field full"><label>Workflow steps</label><ItemsEditor name={n("workflow")} initial={(t?.workflow ?? []).map((w) => ({ title: w.title ?? "", text: w.text ?? "" }))} dir={l.dir} disabled={locked} /></div>
                  <TextArea name={n("notice")} label="Availability / suitability notice" defaultValue={t?.notice} dir={l.dir} disabled={locked} maxLength={600} rows={3} />
                  <Text name={n("cta_label")} label="Button label" defaultValue={t?.cta_label} dir={l.dir} disabled={locked} maxLength={80} />
                  <Text name={n("price_note")} label="Price note (if price shown)" defaultValue={t?.price_note} dir={l.dir} disabled={locked} maxLength={200} />
                  <Text name={n("seo_title")} label="SEO title" defaultValue={t?.seo_title} dir={l.dir} disabled={locked} maxLength={120} />
                  <TextArea name={n("seo_description")} label="SEO description" defaultValue={t?.seo_description} dir={l.dir} disabled={locked} maxLength={320} rows={2} />
                </div>
              ),
            };
          })} />
        </section>
        <div className="btn-row">
          <SubmitButton className="btn secondary" name="intent" value="draft">Save</SubmitButton>
          {canEdit ? <SubmitButton className="btn teal" name="intent" value="publish" pendingText="Publishing…">Save & publish</SubmitButton> : null}
        </div>
      </ActionForm>
    </>
  );
}
