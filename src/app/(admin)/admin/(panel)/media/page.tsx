import Link from "next/link";
import { MediaUploader } from "@/components/admin/MediaUploader";
import { can, requireStaff } from "@/lib/auth";
import { createSessionClient } from "@/lib/admin";
import { MEDIA_SELECT, storageUrl } from "@/lib/media";
import type { MediaRow } from "@/lib/types";

export const metadata = { title: "Media library" };
const CATS = ["", "brand", "treatment-planning", "aligners", "retainers", "snap-on", "team", "general"];

export default async function MediaLibrary({ searchParams }: { searchParams: Promise<{ q?: string; cat?: string }> }) {
  await requireStaff(can.content);
  const { q = "", cat = "" } = await searchParams;
  const db = await createSessionClient();
  let query = db.from("media_assets").select(MEDIA_SELECT).is("deleted_at", null).order("created_at", { ascending: false }).limit(300);
  if (cat && CATS.includes(cat)) query = query.eq("category", cat);
  if (q) query = query.ilike("filename", `%${q.replace(/[%_]/g, "")}%`);
  const { data, error } = await query;
  const rows = (data ?? []) as unknown as MediaRow[];
  return (
    <>
      <div className="topbar"><div><h1>Media library</h1><div className="sub">Images are stored in Supabase Storage and referenced by ID, so replacing a file updates every page that uses it.</div></div></div>
      <section className="panel"><h2>Upload</h2><MediaUploader /></section>
      <section className="panel tight">
        <form className="filters" method="get">
          <div className="field grow"><label htmlFor="q">Search file name</label><input id="q" name="q" type="search" defaultValue={q} /></div>
          <div className="field"><label htmlFor="cat">Category</label><select id="cat" name="cat" defaultValue={cat}>{CATS.map((c) => <option key={c} value={c}>{c || "All"}</option>)}</select></div>
          <button className="btn secondary" type="submit">Filter</button>
        </form>
        {error ? <div className="flash err" style={{ margin: 16 }}>{error.message}</div> : null}
        <div style={{ padding: 16 }}>
          {rows.length === 0 ? <div className="empty">No images found.</div> : null}
          <div className="media-grid">
            {rows.map((m) => {
              const missingAlt = !(m.media_asset_translations ?? []).some((t) => t.alt_text);
              return (
                <Link key={m.id} href={`/admin/media/${m.id}`} className="media-tile">
                  <div className="thumb"><img src={storageUrl(m.bucket, m.variants?.["480"] ?? m.path)} alt="" loading="lazy" /></div>
                  <div className="meta">
                    <strong>{m.filename}</strong>
                    {m.category} · {m.width}×{m.height}
                    <div>{m.is_brand_asset ? <span className="pill">brand</span> : null} {missingAlt ? <span className="pill draft">alt text missing</span> : null}</div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}
