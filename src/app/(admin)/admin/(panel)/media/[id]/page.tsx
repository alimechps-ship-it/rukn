import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { Check, Select, Text } from "@/components/admin/fields";
import { MediaUploader } from "@/components/admin/MediaUploader";
import { can, requireStaff } from "@/lib/auth";
import { allLanguages, createSessionClient, fmtDate } from "@/lib/admin";
import { MEDIA_SELECT, storageUrl } from "@/lib/media";
import type { MediaRow } from "@/lib/types";
import { deleteMedia, saveMedia } from "../../_actions/media";

export const metadata = { title: "Image" };
const CATS = ["brand", "treatment-planning", "aligners", "retainers", "snap-on", "team", "general"];

export default async function MediaDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireStaff(can.content);
  const db = await createSessionClient();
  const [{ data }, langs, { data: usage }] = await Promise.all([
    db.from("media_assets").select(MEDIA_SELECT).eq("id", id).maybeSingle(),
    allLanguages(db),
    db.rpc("media_usage", { p_media_id: id }),
  ]);
  const m = data as unknown as MediaRow | null;
  if (!m) notFound();
  const used = (usage ?? []) as { entity_type: string; entity_id: string | null; label: string }[];
  const src = storageUrl(m.bucket, m.path);
  return (
    <>
      <div className="topbar"><div><div className="small"><Link href="/admin/media">← Media library</Link></div><h1>{m.filename}</h1><div className="sub">{m.width}×{m.height} · {(m.size_bytes / 1024).toFixed(0)} KB · uploaded {fmtDate(m.created_at)}</div></div></div>
      <div className="cols">
        <section className="panel">
          <img src={src} alt="" style={{ width: "100%", borderRadius: 8, background: "var(--light)" }} />
          <p className="small muted" style={{ wordBreak: "break-all" }}>Responsive sizes: {Object.keys(m.variants ?? {}).join(", ") || "—"} px + full</p>
          <h3>Where it is used</h3>
          {used.length === 0 ? <p className="muted">Not used anywhere — it can be deleted.</p> : (
            <ul>{used.map((u, i) => (
              <li key={i}>
                {u.entity_type === "service" || u.entity_type === "service_gallery" ? <Link href={`/admin/services/${u.entity_id}`}>{u.label}</Link>
                  : u.entity_type === "section" ? <Link href={`/admin/sections/${u.entity_id}`}>{u.label}</Link>
                  : u.entity_type === "page" ? <Link href={`/admin/pages/${u.entity_id}`}>{u.label}</Link>
                  : u.entity_type === "team" ? <Link href={`/admin/team/${u.entity_id}`}>{u.label}</Link>
                  : <Link href="/admin/settings">{u.label}</Link>}
              </li>
            ))}</ul>
          )}
          <h3 style={{ marginTop: 18 }}>Replace file</h3>
          <MediaUploader replaceId={m.id} />
          <div style={{ marginTop: 18 }}>
            <ConfirmAction action={deleteMedia} hidden={{ id: m.id }} danger small={false} label="Delete image" title="Delete this image permanently?"
              message={used.length ? "This image is still in use, so the deletion will be refused. Remove it from the places listed first." : "The file and all its sizes are removed from storage. This cannot be undone."} confirmLabel="Delete" />
          </div>
        </section>
        <section className="panel">
          <h2>Details</h2>
          <ActionForm action={saveMedia.bind(null, m.id)}>
            <div className="form-grid">
              <Text name="filename" label="File name" defaultValue={m.filename} maxLength={200} full />
              <Select name="category" label="Category" defaultValue={m.category} options={CATS.map((c) => ({ value: c, label: c }))} />
              <div />
              <Check name="is_brand_asset" label="Brand asset (logo etc.)" defaultChecked={m.is_brand_asset} />
              {langs.map((l) => {
                const t = (m.media_asset_translations ?? []).find((x) => x.locale === l.code);
                const locked = !can.locale(user, l.code);
                return (
                  <div className="full form-grid" key={l.code} style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
                    <Text name={`tr.${l.code}.alt_text`} label={`Alt text (${l.native_name})`} defaultValue={t?.alt_text} dir={l.dir} disabled={locked} maxLength={300} hint="Describe the image for screen readers and search engines." />
                    <Text name={`tr.${l.code}.caption`} label={`Caption (${l.native_name})`} defaultValue={t?.caption} dir={l.dir} disabled={locked} maxLength={300} />
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 14 }}><SubmitButton>Save details</SubmitButton></div>
          </ActionForm>
        </section>
      </div>
    </>
  );
}
