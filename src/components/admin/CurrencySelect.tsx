import type { ChangeEvent } from "react";
import { currencyLabel, sortCurrencies } from "@/lib/currencies";

/**
 * Currency drop-down (no free typing). Works in server and client components.
 * The current value is always offered, even if it is no longer in the list.
 */
export function CurrencySelect({ id, name, options, value, defaultValue, onChange, disabled, locked, required, short, title }: {
  id: string; name?: string; options: string[]; value?: string; defaultValue?: string | null;
  onChange?: (e: ChangeEvent<HTMLSelectElement>) => void; disabled?: boolean;
  /** shown but not changeable, still submitted (e.g. the currency of a cash box) */
  locked?: boolean; required?: boolean; short?: boolean; title?: string;
}) {
  const current = (value ?? defaultValue ?? "").toUpperCase();
  const list = sortCurrencies([...options, current]);
  const opts = list.map((c) => <option key={c} value={c}>{currencyLabel(c, short)}</option>);
  if (locked) {
    return (
      <>
        <select id={id} value={current} disabled title={title} onChange={() => {}}>{opts}</select>
        {name ? <input type="hidden" name={name} value={current} /> : null}
      </>
    );
  }
  return value !== undefined ? (
    <select id={id} name={name} value={current} onChange={onChange} disabled={disabled} required={required} title={title}>
      {current ? null : <option value="">— choose · اختر —</option>}{opts}
    </select>
  ) : (
    <select id={id} name={name} defaultValue={current || list[0]} disabled={disabled} required={required} title={title}>{opts}</select>
  );
}
