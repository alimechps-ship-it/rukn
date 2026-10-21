"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { registerCaseFile } from "@/app/(admin)/admin/(panel)/_actions/cases";
import { FILE_CATEGORIES, FILE_EXTENSIONS, MAX_FILE_BYTES } from "@/lib/cases";

type Row = { name: string; state: "waiting" | "uploading" | "done" | "error"; message?: string; pct?: number };

/** Uploads clinical files straight into the private "case-files" bucket (RLS-protected). */
export function CaseFileUploader({ caseId, staff }: { caseId: string; staff: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState(staff ? "treatment_plan" : "scan_upper");
  const [deliverable, setDeliverable] = useState(staff);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const set = (i: number, r: Partial<Row>) => setRows((xs) => xs.map((x, j) => (j === i ? { ...x, ...r } : x)));

  async function handle(files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files).slice(0, 20);
    setRows(list.map((f) => ({ name: f.name, state: "waiting" })));
    setBusy(true);
    const supabase = createBrowserSupabase();
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
      if (!FILE_EXTENSIONS.includes(ext)) { set(i, { state: "error", message: `.${ext} files are not accepted.` }); continue; }
      if (f.size > MAX_FILE_BYTES) { set(i, { state: "error", message: `File is ${(f.size / 1048576).toFixed(1)} MB; the limit is 50 MB. Compress it (ZIP) or split it.` }); continue; }
      const path = `${caseId}/${crypto.randomUUID()}.${ext}`;
      set(i, { state: "uploading" });
      const { error } = await supabase.storage.from("case-files").upload(path, f, { contentType: f.type || "application/octet-stream", upsert: false });
      if (error) { set(i, { state: "error", message: `Upload failed: ${error.message}` }); continue; }
      const res = await registerCaseFile({ caseId, path, filename: f.name, size: f.size, mime: f.type, category, deliverable: staff && deliverable });
      set(i, res.ok ? { state: "done", message: "Uploaded" } : { state: "error", message: res.message });
    }
    setBusy(false);
    if (input.current) input.current.value = "";
    router.refresh();
  }

  return (
    <div>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="cf-cat">File type</label>
          <select id="cf-cat" value={category} onChange={(e) => setCategory(e.target.value)} disabled={busy}>
            {Object.entries(FILE_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.en} · {v.ar}</option>)}
          </select>
        </div>
        {staff ? (
          <div className="field"><label>&nbsp;</label><label className="check"><input type="checkbox" checked={deliverable} onChange={(e) => setDeliverable(e.target.checked)} /> Deliverable to the agent (plan, report)</label></div>
        ) : <div />}
        <div className="field full">
          <label htmlFor="cf-file">Choose files</label>
          <input id="cf-file" ref={input} type="file" multiple disabled={busy} accept={FILE_EXTENSIONS.map((e) => `.${e}`).join(",")} onChange={(e) => handle(e.target.files)} />
          <div className="hint">STL, PLY, OBJ, 3MF, ZIP, PDF, JPG, PNG, DICOM, MP4 · max 50 MB each · stored privately and encrypted at rest; only you and RUKN case staff can open them.</div>
        </div>
      </div>
      {rows.length ? (
        <ul className="timeline" aria-live="polite">
          {rows.map((r, i) => (
            <li key={i}>
              <strong>{r.name}</strong> — {r.state === "uploading" ? "uploading…" : r.state === "waiting" ? "waiting" : null}
              {r.state === "done" ? <span style={{ color: "var(--ok)" }}>{r.message}</span> : null}
              {r.state === "error" ? <span style={{ color: "var(--danger)" }}>{r.message}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
