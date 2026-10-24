import { loadCurrencies } from "@/lib/currency-list";
import { CurrencySelect } from "./CurrencySelect";

/** Labelled currency drop-down for server-rendered forms (list = currencies on the Exchange rates page). */
export async function CurrencyField({ id, name, label = "Currency · العملة", defaultValue, full, required, hint }: {
  id: string; name: string; label?: string; defaultValue?: string | null; full?: boolean; required?: boolean; hint?: string;
}) {
  const options = await loadCurrencies();
  return (
    <div className={`field${full ? " full" : ""}`}>
      <label htmlFor={id}>{label}</label>
      <CurrencySelect id={id} name={name} options={options} defaultValue={defaultValue || options[0]} required={required} />
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}
