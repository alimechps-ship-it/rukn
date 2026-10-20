import type { ReactNode } from "react";

interface Base { name: string; label: string; hint?: ReactNode; full?: boolean; dir?: "ltr" | "rtl"; disabled?: boolean; required?: boolean }

export function Text({ name, label, hint, full, dir, disabled, required, defaultValue, maxLength = 300, type = "text", placeholder }: Base & { defaultValue?: string | number | null; maxLength?: number; type?: string; placeholder?: string }) {
  return (
    <div className={`field${full ? " full" : ""}`}>
      <label htmlFor={name}>{label}{required ? " *" : ""}</label>
      <input id={name} name={name} type={type} dir={dir} disabled={disabled} required={required} defaultValue={defaultValue ?? ""} maxLength={type === "number" ? undefined : maxLength} placeholder={placeholder} />
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export function TextArea({ name, label, hint, full = true, dir, disabled, required, defaultValue, maxLength = 8000, rows = 4 }: Base & { defaultValue?: string | null; maxLength?: number; rows?: number }) {
  return (
    <div className={`field${full ? " full" : ""}`}>
      <label htmlFor={name}>{label}{required ? " *" : ""}</label>
      <textarea id={name} name={name} dir={dir} disabled={disabled} required={required} defaultValue={defaultValue ?? ""} maxLength={maxLength} rows={rows} />
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export function Check({ name, label, defaultChecked, disabled, hint }: { name: string; label: string; defaultChecked?: boolean; disabled?: boolean; hint?: ReactNode }) {
  return (
    <div className="field">
      <label className="check"><input type="checkbox" name={name} defaultChecked={defaultChecked} disabled={disabled} /> {label}</label>
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export function Select({ name, label, options, defaultValue, disabled, hint, full }: { name: string; label: string; options: { value: string; label: string }[]; defaultValue?: string | null; disabled?: boolean; hint?: ReactNode; full?: boolean }) {
  return (
    <div className={`field${full ? " full" : ""}`}>
      <label htmlFor={name}>{label}</label>
      <select id={name} name={name} defaultValue={defaultValue ?? ""} disabled={disabled}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export function StatusPill({ status, pending }: { status: string; pending?: boolean }) {
  return (
    <>
      <span className={`pill ${status}`}>{status}</span>
      {pending ? <> <span className="pill changes" title="Draft differs from the published version">unpublished changes</span></> : null}
    </>
  );
}

export const RICH_HINT = "Blank line = new paragraph · “## ” = sub-heading · “- ” = bullet · **bold**";
