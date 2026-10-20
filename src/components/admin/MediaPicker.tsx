"use client";

import { useMemo, useRef, useState } from "react";

export interface PickerMedia { id: string; src: string; filename: string; category: string }

/** Choose one (or several, ordered) images from the media library. */
export function MediaPicker({
  name, media, value, multiple = false, disabled,
}: { name: string; media: PickerMedia[]; value: string | string[] | null; multiple?: boolean; disabled?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<string[]>(Array.isArray(value) ? value : value ? [value] : []);
  const [filter, setFilter] = useState("");
  const byId = useMemo(() => new Map(media.map((m) => [m.id, m])), [media]);
  const shown = media.filter((m) => !filter || m.filename.toLowerCase().includes(filter.toLowerCase()) || m.category === filter);

  const toggle = (id: string) => {
    if (!multiple) { setSelected([id]); ref.current?.close(); return; }
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };
  const move = (i: number, d: number) => setSelected((s) => {
    const j = i + d;
    if (j < 0 || j >= s.length) return s;
    const c = [...s];
    [c[i], c[j]] = [c[j], c[i]];
    return c;
  });

  return (
    <div>
      <input type="hidden" name={name} value={multiple ? JSON.stringify(selected) : selected[0] ?? ""} />
      <div className="picker-preview" style={{ flexWrap: "wrap" }}>
        {selected.length === 0 ? <div className="thumb">No image</div> : null}
        {selected.map((id, i) => {
          const m = byId.get(id);
          return (
            <div key={id} style={{ display: "grid", gap: 4 }}>
              <div className="thumb">{m ? <img src={m.src} alt="" /> : "Missing"}</div>
              {multiple && !disabled ? (
                <div className="btn-row">
                  <button type="button" className="btn secondary small" onClick={() => move(i, -1)} aria-label="Move earlier">←</button>
                  <button type="button" className="btn secondary small" onClick={() => move(i, 1)} aria-label="Move later">→</button>
                  <button type="button" className="btn danger small" onClick={() => setSelected((s) => s.filter((x) => x !== id))} aria-label="Remove">✕</button>
                </div>
              ) : null}
            </div>
          );
        })}
        {!disabled ? (
          <div className="btn-row">
            <button type="button" className="btn secondary small" onClick={() => ref.current?.showModal()}>{multiple ? "Add / remove images" : selected.length ? "Replace image" : "Choose image"}</button>
            {!multiple && selected.length ? <button type="button" className="btn danger small" onClick={() => setSelected([])}>Remove</button> : null}
          </div>
        ) : null}
      </div>
      <dialog ref={ref}>
        <div className="dlg-head">
          <strong>Media library</strong>
          <input type="search" placeholder="Filter by name or category" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 260 }} />
        </div>
        <div className="dlg-body">
          {shown.length === 0 ? <p className="muted">No images found. Upload images in the Media Library first.</p> : null}
          <div className="media-grid">
            {shown.map((m) => (
              <button type="button" key={m.id} className={`media-tile${selected.includes(m.id) ? " selected" : ""}`} onClick={() => toggle(m.id)} style={{ padding: 0, cursor: "pointer", textAlign: "start" }}>
                <div className="thumb"><img src={m.src} alt="" loading="lazy" /></div>
                <div className="meta"><strong>{m.filename}</strong>{m.category}</div>
              </button>
            ))}
          </div>
        </div>
        <div className="dlg-foot"><button type="button" className="btn" onClick={() => ref.current?.close()}>Done</button></div>
      </dialog>
    </div>
  );
}
