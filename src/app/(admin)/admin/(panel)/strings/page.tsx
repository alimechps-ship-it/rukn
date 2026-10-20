import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { can, requireStaff } from "@/lib/auth";
import { allLanguages, createSessionClient } from "@/lib/admin";
import { saveString } from "../_actions/simple";

export const metadata = { title: "Interface text" };

export default async function Strings({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireStaff(can.translate);
  const { q = "" } = await searchParams;
  const db = await createSessionClient();
  const [{ data, error }, langs] = await Promise.all([
    db.from("translations").select("key,locale,value").eq("namespace", "ui").order("key"),
    allLanguages(db),
  ]);
  const keys = [...new Set((data ?? []).map((r) => r.key))].filter((k) => {
    if (!q) return true;
    const needle = q.toLowerCase();
    return k.includes(needle) || (data ?? []).some((r) => r.key === k && r.value.toLowerCase().includes(needle));
  });
  const val = (k: string, l: string) => (data ?? []).find((r) => r.key === k && r.locale === l)?.value ?? "";
  return (
    <>
      <div className="topbar"><div><h1>Interface text</h1><div className="sub">Buttons, form labels, validation messages and other small texts — per language. Changes go live when saved.</div></div></div>
      {error ? <div className="flash err">{error.message}</div> : null}
      <section className="panel tight">
        <form className="filters" method="get">
          <div className="field grow"><label htmlFor="q">Search</label><input id="q" name="q" type="search" defaultValue={q} placeholder="Key or text…" /></div>
          <button className="btn secondary" type="submit">Filter</button>
        </form>
        <div style={{ padding: "4px 16px" }}>
          {keys.map((k) => (
            <ActionForm key={k} action={saveString}>
              <input type="hidden" name="key" value={k} />
              <div className="form-grid" style={{ gridTemplateColumns: `200px ${langs.map(() => "1fr").join(" ")} auto`, alignItems: "end", paddingBlock: 10, borderBottom: "1px solid var(--line)" }}>
                <div className="mono small" style={{ alignSelf: "center" }}>{k}</div>
                {langs.map((l) => {
                  const locked = !can.locale(user, l.code);
                  const v = val(k, l.code);
                  return (
                    <div className="field" key={l.code}>
                      <label className="small">{l.code.toUpperCase()}</label>
                      {v.length > 70
                        ? <textarea name={`v.${l.code}`} dir={l.dir} defaultValue={v} disabled={locked} rows={2} maxLength={2000} />
                        : <input type="text" name={`v.${l.code}`} dir={l.dir} defaultValue={v} disabled={locked} maxLength={2000} />}
                    </div>
                  );
                })}
                <SubmitButton className="btn secondary small">Save</SubmitButton>
              </div>
            </ActionForm>
          ))}
          {keys.length === 0 ? <div className="empty">No matching texts.</div> : null}
        </div>
      </section>
    </>
  );
}
