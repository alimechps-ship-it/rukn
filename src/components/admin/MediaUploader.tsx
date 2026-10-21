"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { processUpload } from "@/app/(admin)/admin/(panel)/_actions/media";

const TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];
const MAX = 10 * 1024 * 1024;
const CATEGORIES = ["general", "brand", "treatment-planning", "aligners", "retainers", "snap-on", "team"];

type Row = { name: string; state: "waiting" | "uploading" | "processing" | "done" | "error"; message?: string };

/** Uploads straight to Supabase Storage (no server body-size limits), then the server validates and optimises. */
export function MediaUploader({ replaceId }: { replaceId?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [category, setCategory] = useState("general");
  const illustrative = false;
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const set = (i: number, r: Partial<Row>) => setRows((xs) => xs.map((x, j) => (j === i ? { ...x, ...r } : x)));

  async function handle(files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files).slice(0, replaceId ? 1 : 20);
    setRows(list.map((f) => ({ name: f.name, state: "waiting" })));
    setBusy(true);
    const supabase = createBrowserSupabase();
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      if (!TYPES.includes(f.type)) { set(i, { state: "error", message: "Only JPG, PNG, WebP or AVIF images are accepted." }); continue; }
      if (f.size > MAX) { set(i, { state: "error", message: `File is ${(f.size / 1048576).toFixed(1)} MB; the limit is 10 MB.` }); continue; }
      const ext = f.type === "image/jpeg" ? "jpg" : f.type.split("/")[1];
      const path = `incoming/${crypto.randomUUID()}.${ext}`;
      set(i, { state: "uploading" });
      const { error } = await supabase.storage.from("media").upload(path, f, { contentType: f.type, upsert: false });
      if (error) { set(i, { state: "error", message: `Upload failed: ${error.message}` }); continue; }
      set(i, { state: "processing" });
      try {
        const res = await processUpload({ incomingPath: path, filename: f.name, category, replaceId: replaceId ?? null, illustrative });
        set(i, res?.ok ? { state: "done", message: res.message } : { state: "error", message: res?.message ?? "Processing failed." });
      } catch (e) {
        set(i, { state: "error", message: e instanceof Error ? e.message : "Processing failed." });
      }
    }
    setBusy(false);
    if (input.current) input.current.value = "";
    router.refresh();
  }

  return (
    <div>
      <div className="form-grid">
        {!replaceId ? (
          <>
            <div className="field">
              <label htmlFor="up-cat">Category</label>
              <select id="up-cat" value={category} onChange={(e) => setCategory(e.target.value)}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
            </div>
          </>
        ) : null}
        <div className="field full">
          <label htmlFor="up-file">{replaceId ? "Choose a replacement image" : "Choose images to upload"}</label>
          <input id="up-file" ref={input} type="file" accept={TYPES.join(",")} multiple={!replaceId} disabled={busy} onChange={(e) => handle(e.target.files)} />
          <div className="hint">JPG, PNG, WebP or AVIF · max 10 MB each · converted to optimised WebP in several sizes. Upload only images RUKN owns or is licensed to use.</div>
        </div>
      </div>
      {rows.length ? (
        <ul className="timeline" aria-live="polite">
          {rows.map((r, i) => (
            <li key={i}>
              <strong>{r.name}</strong> — {r.state === "uploading" ? "uploading…" : r.state === "processing" ? "validating & optimising…" : r.state === "waiting" ? "waiting" : null}
              {r.state === "done" ? <span style={{ color: "var(--ok)" }}>{r.message}</span> : null}
              {r.state === "error" ? <span style={{ color: "var(--danger)" }}>{r.message}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
