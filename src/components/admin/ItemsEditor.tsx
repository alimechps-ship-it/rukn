"use client";

import { useState } from "react";
import { ITEM_ICONS, ITEM_ICON_KEYS } from "@/components/icons";

interface Item { title: string; text: string; icon?: string }

/** Editable list of {title, text} items serialised to a hidden JSON input. */
export function ItemsEditor({ name, initial, dir, disabled, withIcons = false }: { name: string; initial: Item[]; dir: "ltr" | "rtl"; disabled?: boolean; withIcons?: boolean }) {
  const [items, setItems] = useState<Item[]>(initial.length ? initial : []);
  const update = (i: number, k: keyof Item, v: string) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, [k]: k === "icon" ? v || undefined : v } : x)));
  const move = (i: number, d: number) => setItems((xs) => {
    const j = i + d;
    if (j < 0 || j >= xs.length) return xs;
    const c = [...xs];
    [c[i], c[j]] = [c[j], c[i]];
    return c;
  });
  return (
    <div className="items-editor">
      <input type="hidden" name={name} value={JSON.stringify(items.filter((x) => x.title.trim() || x.text.trim()))} />
      {items.map((it, i) => (
        <div className="row" key={i}>
          {withIcons ? (
            <div style={{ display: "flex", gap: 6, alignItems: "center", gridColumn: "1 / -1" }}>
              {(() => { const I = it.icon ? ITEM_ICONS[it.icon] : null; return I ? <I size={20} /> : <span className="small muted">auto</span>; })()}
              <select value={it.icon ?? ""} disabled={disabled} onChange={(e) => update(i, "icon", e.target.value)} aria-label={`Item ${i + 1} icon`} style={{ maxWidth: 220 }}>
                <option value="">Icon: automatic</option>
                {ITEM_ICON_KEYS.map((k) => <option key={k} value={k}>Icon: {k}</option>)}
              </select>
            </div>
          ) : null}
          <input type="text" dir={dir} placeholder="Title" value={it.title} disabled={disabled} maxLength={200} onChange={(e) => update(i, "title", e.target.value)} aria-label={`Item ${i + 1} title`} />
          <textarea dir={dir} placeholder="Text" value={it.text} disabled={disabled} maxLength={1000} style={{ minHeight: 42 }} onChange={(e) => update(i, "text", e.target.value)} aria-label={`Item ${i + 1} text`} />
          {!disabled ? (
            <div className="ops">
              <button type="button" className="btn secondary small" onClick={() => move(i, -1)} aria-label="Move up">↑</button>
              <button type="button" className="btn secondary small" onClick={() => move(i, 1)} aria-label="Move down">↓</button>
              <button type="button" className="btn danger small" onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))} aria-label="Remove">✕</button>
            </div>
          ) : null}
        </div>
      ))}
      {!disabled ? <button type="button" className="btn secondary small" onClick={() => setItems((xs) => [...xs, { title: "", text: "" }])}>+ Add item</button> : null}
    </div>
  );
}
