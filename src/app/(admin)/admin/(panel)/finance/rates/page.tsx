import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { can, requireStaff } from "@/lib/auth";
import { createSessionClient, fmtDate } from "@/lib/admin";
import { profileMap } from "@/lib/case-data";
import { cross, fmtRate, FX_MAX_AGE_HOURS, loadRates, ratesMap, refreshAutoRates } from "@/lib/fx";
import { deleteRate, saveRate, unlockRate, updateRatesNow } from "../../_actions/finance";

export const metadata = { title: "Exchange rates" };

export default async function RatesPage() {
  await requireStaff(can.finance);
  const db = await createSessionClient();
  const auto = await refreshAutoRates(db, true);
  const [rates, { data: boxes }, { data: hist }] = await Promise.all([
    loadRates(db),
    db.from("cash_accounts").select("currency").eq("active", true),
    db.from("exchange_rate_history").select("*").order("changed_at", { ascending: false }).limit(25),
  ]);
  const fx = ratesMap(rates);
  const used = [...new Set([...(boxes ?? []).map((b) => b.currency as string)])].sort();
  const missing = used.filter((c) => !fx.has(c));
  const matrix = used.filter((c) => fx.has(c));
  const people = await profileMap(db, [...rates.map((r) => r.updated_by), ...(hist ?? []).map((h) => h.changed_by)]);

  return (
    <>
      <div className="topbar">
        <div>
          <div className="small"><Link href="/admin/finance/cash">← Cash boxes</Link></div>
          <h1>Exchange rates · أسعار الصرف</h1>
          <div className="sub">All currencies are linked through the US dollar. Rates update automatically from the internet (at most every {FX_MAX_AGE_HOURS} hours, or now with the button). Lock a rate to keep your own value. Every transfer between boxes in different currencies uses these rates — or a rate you type on the transfer.</div>
        </div>
        <div className="btn-row">
          <ActionForm action={updateRatesNow}><SubmitButton className="btn teal" pendingText="Updating…">⟳ Update rates now · تحديث الآن</SubmitButton></ActionForm>
        </div>
      </div>
      {auto.error ? <div className="flash warn">{auto.error}</div> : null}
      {missing.length ? <div className="flash warn">No rate yet for {missing.join(", ")} (used by a cash box). Add it below.</div> : null}

      <section className="panel">
        <h2>Rates · الأسعار</h2>
        <div className="table-scroll">
          <table className="data">
            <thead><tr><th>Currency</th><th className="num">1 USD =</th><th className="num">1 unit = USD</th>{fx.has("EGP") ? <th className="num">1 unit = EGP</th> : null}<th>Source</th><th>Updated</th><th style={{ minWidth: 300 }}>Set by hand · تعديل يدوي</th></tr></thead>
            <tbody>
              {rates.map((r) => (
                <tr key={r.currency}>
                  <td><strong>{r.currency}</strong></td>
                  <td className="num">{fmtRate(r.per_usd)}</td>
                  <td className="num">{fmtRate(1 / r.per_usd)}</td>
                  {fx.has("EGP") ? <td className="num">{fmtRate(cross(fx, r.currency, "EGP"))}</td> : null}
                  <td>{r.currency === "USD" ? <span className="pill draft">reference</span> : r.locked ? <span className="pill changes">manual · locked 🔒</span> : r.source === "auto" ? <span className="pill published">automatic</span> : <span className="pill new">manual (until next update)</span>}</td>
                  <td className="small">{fmtDate(r.updated_at)}<div className="muted">{r.source === "auto" ? "internet" : people.get(r.updated_by ?? "")?.name ?? ""}</div></td>
                  <td>
                    {r.currency === "USD" ? <span className="small muted">always 1</span> : (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                        <ActionForm action={saveRate} className="inline-form">
                          <input type="hidden" name="currency" value={r.currency} />
                          <input type="number" name="per_usd" step="any" min="0" defaultValue={r.per_usd} aria-label={`1 USD in ${r.currency}`} style={{ width: 120 }} />
                          <label className="small nowrap"><input type="checkbox" name="locked" defaultChecked={r.locked || r.source === "manual"} /> lock</label>
                          <SubmitButton className="btn secondary small">Save</SubmitButton>
                        </ActionForm>
                        {r.locked ? <ActionForm action={unlockRate}><input type="hidden" name="currency" value={r.currency} /><SubmitButton className="btn secondary small">↺ Automatic</SubmitButton></ActionForm> : null}
                        {!used.includes(r.currency) ? <ConfirmAction action={deleteRate} hidden={{ currency: r.currency }} danger label="✕" title={`Remove ${r.currency}?`} message="It is not used by any active cash box." confirmLabel="Remove" /> : null}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <details style={{ marginTop: 12 }} open={missing.length > 0}>
          <summary><strong>+ Add a currency · إضافة عملة</strong></summary>
          <ActionForm action={saveRate} className="form-grid" resetOnSuccess>
            <div className="field"><label htmlFor="nr-cur">Currency code</label><input id="nr-cur" type="text" name="currency" maxLength={3} required defaultValue={missing[0] ?? ""} placeholder="e.g. QAR" /></div>
            <div className="field"><label htmlFor="nr-rate">1 USD =</label><input id="nr-rate" type="number" name="per_usd" step="any" min="0" required /></div>
            <div className="field"><label className="small"><input type="checkbox" name="locked" /> Lock (do not update automatically)</label></div>
            <div className="full"><SubmitButton className="btn teal">Add currency</SubmitButton></div>
          </ActionForm>
          <p className="small muted">Unlocked currencies are updated automatically on the next update.</p>
        </details>
      </section>

      {matrix.length > 1 ? (
        <section className="panel">
          <h2>Between your boxes&apos; currencies · بين عملات الصناديق</h2>
          <div className="table-scroll">
            <table className="data">
              <thead><tr><th>1 unit of ↓ =</th>{matrix.map((c) => <th key={c} className="num">{c}</th>)}</tr></thead>
              <tbody>{matrix.map((f) => <tr key={f}><td><strong>{f}</strong></td>{matrix.map((t) => <td key={t} className="num">{f === t ? "—" : fmtRate(cross(fx, f, t))}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <h2>Recent changes · سجل التغييرات</h2>
        {(hist ?? []).length ? (
          <table className="data">
            <tbody>
              {(hist ?? []).map((h) => (
                <tr key={h.id}>
                  <td className="small">{fmtDate(h.changed_at)}</td>
                  <td><strong>{h.currency}</strong></td>
                  <td className="num small">{h.old_per_usd !== null ? fmtRate(Number(h.old_per_usd)) : "—"} → <strong>{fmtRate(Number(h.new_per_usd))}</strong></td>
                  <td className="small">{h.source === "auto" ? "automatic" : `manual · ${people.get(h.changed_by ?? "")?.name ?? ""}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="small muted">No changes yet.</p>}
      </section>
    </>
  );
}
