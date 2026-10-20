import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { InstantAction } from "@/components/admin/InstantAction";
import { Select, Text } from "@/components/admin/fields";
import { can, requireStaff } from "@/lib/auth";
import { allLanguages, createSessionClient } from "@/lib/admin";
import { move } from "../_actions/content";
import { createNavItem, deleteNavItem, saveNavItem } from "../_actions/simple";

export const metadata = { title: "Navigation" };
const LOCATIONS = [
  { value: "header", label: "Header menu" },
  { value: "footer", label: "Footer links (links under /services go to the “Services” column)" },
  { value: "footer_legal", label: "Footer legal links" },
];

export default async function Navigation() {
  const user = await requireStaff(can.translate);
  const db = await createSessionClient();
  const [{ data, error }, langs] = await Promise.all([
    db.from("navigation_items").select("id,location,href,is_visible,sort_order,navigation_item_translations(locale,label)").order("sort_order"),
    allLanguages(db),
  ]);
  const canEdit = can.content(user);
  return (
    <>
      <div className="topbar"><div><h1>Navigation & footer</h1><div className="sub">Internal links like /about automatically get the visitor’s language prefix. Footer text and contact details are under Settings.</div></div></div>
      {error ? <div className="flash err">{error.message}</div> : null}
      {LOCATIONS.map((loc) => (
        <section className="panel" key={loc.value}>
          <h2>{loc.label}</h2>
          {(data ?? []).filter((n) => n.location === loc.value).map((n) => (
            <div key={n.id} style={{ borderBottom: "1px solid var(--line)", paddingBlock: 10 }}>
              <ActionForm action={saveNavItem.bind(null, n.id)}>
                <div className="form-grid" style={{ gridTemplateColumns: `1.2fr ${langs.map(() => "1fr").join(" ")} auto` }}>
                  <Text name="href" label="Link" defaultValue={n.href} disabled={!canEdit} />
                  {langs.map((l) => {
                    const locked = !can.locale(user, l.code);
                    return (
                      <div key={l.code}>
                        <input type="hidden" name={`tr.${l.code}.present`} value="1" disabled={locked} />
                        <Text name={`tr.${l.code}.label`} label={`Label (${l.code.toUpperCase()})`} dir={l.dir} defaultValue={n.navigation_item_translations.find((t) => t.locale === l.code)?.label} disabled={locked} maxLength={80} />
                      </div>
                    );
                  })}
                  <div className="field"><label>&nbsp;</label><label className="check"><input type="checkbox" name="is_visible" defaultChecked={n.is_visible} disabled={!canEdit} /> Visible</label></div>
                </div>
                <div className="btn-row" style={{ marginTop: 8 }}>
                  <SubmitButton className="btn secondary small">Save</SubmitButton>
                </div>
              </ActionForm>
              {canEdit ? (
                <div className="btn-row" style={{ marginTop: 6 }}>
                  <InstantAction action={move} hidden={{ table: "navigation_items", id: n.id, dir: "up", scope: "location", scopeVal: loc.value }} title="Move up">↑</InstantAction>
                  <InstantAction action={move} hidden={{ table: "navigation_items", id: n.id, dir: "down", scope: "location", scopeVal: loc.value }} title="Move down">↓</InstantAction>
                  <ConfirmAction action={deleteNavItem} hidden={{ id: n.id }} danger label="Delete" title="Delete link?" message="The link is removed from the website immediately. This cannot be undone." confirmLabel="Delete" />
                </div>
              ) : null}
            </div>
          ))}
        </section>
      ))}
      {canEdit ? (
        <section className="panel">
          <h2>Add a link</h2>
          <ActionForm action={createNavItem} className="form-grid" resetOnSuccess>
            <Select name="location" label="Location" options={LOCATIONS} defaultValue="header" />
            <Text name="href" label="Link" required placeholder="/about or https://…" />
            <Text name="label" label="Label (default language)" required maxLength={80} />
            <div className="full"><SubmitButton>Add link</SubmitButton></div>
          </ActionForm>
        </section>
      ) : null}
    </>
  );
}
