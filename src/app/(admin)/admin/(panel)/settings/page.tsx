import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { Check, Select, Text, TextArea } from "@/components/admin/fields";
import { LocaleTabs } from "@/components/admin/LocaleTabs";
import { MediaPicker } from "@/components/admin/MediaPicker";
import { can, requireStaff } from "@/lib/auth";
import { allLanguages, createSessionClient, pickerMedia } from "@/lib/admin";
import { addLanguage, saveGeneralSettings, saveNotifications, saveSiteTexts, updateLanguage } from "../_actions/settings";

export const metadata = { title: "Settings" };

export default async function Settings() {
  const user = await requireStaff(can.translate);
  const isAdmin = can.admin(user);
  const db = await createSessionClient();
  const [{ data: s }, { data: trs }, langs, media, priv] = await Promise.all([
    db.from("site_settings").select("*").eq("id", 1).maybeSingle(),
    db.from("site_settings_translations").select("*"),
    allLanguages(db),
    pickerMedia(db),
    isAdmin ? db.from("private_settings").select("*").eq("id", 1).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const colors = (s?.brand_colors ?? {}) as Record<string, string>;
  const social = ((s?.social_links ?? []) as { network: string; url: string }[]).map((l) => `${l.network} | ${l.url}`).join("\n");
  const p = priv.data as { notifications_enabled: boolean; notification_emails: string[]; notify_on_types: string[] } | null;
  const serviceKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const mailer = Boolean(process.env.RESEND_API_KEY && process.env.NOTIFICATION_FROM_EMAIL);

  return (
    <>
      <div className="topbar"><div><h1>Settings</h1><div className="sub">{isAdmin ? "Site-wide configuration." : "You can edit the site texts for your permitted languages. Other settings are managed by a Super Administrator."}</div></div></div>

      <section className="panel">
        <h2>Site texts (per language)</h2>
        <p className="small muted">Footer, location statement, business hours, case-submission instructions, SEO defaults, cookie and maintenance texts. Leave a field empty to hide it.</p>
        <ActionForm action={saveSiteTexts}>
          <LocaleTabs panels={langs.map((l) => {
            const t = (trs ?? []).find((x) => x.locale === l.code) as Record<string, string | null> | undefined;
            const locked = !can.locale(user, l.code);
            const n = (k: string) => `tr.${l.code}.${k}`;
            return {
              code: l.code, label: l.native_name, locked, missing: !t,
              content: (
                <div className="form-grid">
                  <input type="hidden" name={n("present")} value="1" disabled={locked} />
                  <Text name={n("tagline")} label="Tagline" defaultValue={t?.tagline} dir={l.dir} disabled={locked} maxLength={200} />
                  <Text name={n("location_text")} label="Location statement" defaultValue={t?.location_text} dir={l.dir} disabled={locked} maxLength={200} />
                  <TextArea name={n("business_hours")} label="Business hours" defaultValue={t?.business_hours} dir={l.dir} disabled={locked} maxLength={400} rows={2} hint="Hidden on the website while empty. Do not publish hours that are not confirmed." />
                  <TextArea name={n("footer_text")} label="Footer text" defaultValue={t?.footer_text} dir={l.dir} disabled={locked} maxLength={600} rows={3} />
                  <TextArea name={n("case_submission_instructions")} label="Message shown after a case inquiry (secure channel instructions)" defaultValue={t?.case_submission_instructions} dir={l.dir} disabled={locked} maxLength={2000} rows={4} />
                  <Text name={n("default_seo_title")} label="Default SEO title" defaultValue={t?.default_seo_title} dir={l.dir} disabled={locked} maxLength={120} />
                  <TextArea name={n("default_seo_description")} label="Default SEO description" defaultValue={t?.default_seo_description} dir={l.dir} disabled={locked} maxLength={320} rows={2} />
                  <TextArea name={n("cookie_banner_text")} label="Cookie banner text" defaultValue={t?.cookie_banner_text} dir={l.dir} disabled={locked} maxLength={600} rows={2} />
                  <TextArea name={n("maintenance_message")} label="Maintenance message" defaultValue={t?.maintenance_message} dir={l.dir} disabled={locked} maxLength={600} rows={2} />
                </div>
              ),
            };
          })} />
          <SubmitButton>Save site texts</SubmitButton>
        </ActionForm>
      </section>

      {isAdmin && s ? (
        <section className="panel">
          <h2>General, contact & brand</h2>
          <ActionForm action={saveGeneralSettings}>
            <div className="form-grid">
              <Text name="site_name" label="Site name" defaultValue={s.site_name} maxLength={80} />
              <Text name="site_url" label="Public site URL (after a domain is connected)" defaultValue={s.site_url} hint="Leave empty while using the temporary deployment URL. NEXT_PUBLIC_SITE_URL takes priority if set." />
              <Text name="contact_email" label="Business e-mail" type="email" defaultValue={s.contact_email} hint="Hidden on the website while empty." />
              <Text name="whatsapp_number" label="WhatsApp number" defaultValue={s.whatsapp_number} placeholder="+20…" hint="International format. Hidden while empty." />
              <Text name="country_code" label="Country (ISO code)" defaultValue={s.country_code} maxLength={2} />
              <div />
              <TextArea name="social_links" label="Social media links (one per line: Name | https://…)" defaultValue={social} rows={3} />
              <div className="field"><label>Logo</label><MediaPicker name="logo_media_id" media={media} value={s.logo_media_id} /><div className="hint">The official RUKN logo from the media library (category “brand”).</div></div>
              <div className="field"><label>Favicon</label><MediaPicker name="favicon_media_id" media={media} value={s.favicon_media_id} /><div className="hint">Square image. A built-in favicon is used while empty.</div></div>
              <div className="field full"><label>Default social share image</label><MediaPicker name="og_image_media_id" media={media} value={s.og_image_media_id} /></div>
            </div>
            <h3 style={{ marginTop: 16 }}>Brand colours</h3>
            <div className="form-grid" style={{ gridTemplateColumns: "repeat(5, minmax(0,1fr))" }}>
              {["navy", "teal", "white", "light", "text"].map((k) => <Text key={k} name={`color_${k}`} label={k} defaultValue={colors[k]} maxLength={7} />)}
            </div>
            <h3 style={{ marginTop: 16 }}>Analytics, cookies & maintenance</h3>
            <div className="form-grid">
              <Select name="analytics_provider" label="Analytics" defaultValue={s.analytics_provider ?? ""} options={[{ value: "", label: "None" }, { value: "plausible", label: "Plausible (cookieless)" }, { value: "ga4", label: "Google Analytics 4" }]} />
              <Text name="analytics_id" label="Analytics ID / domain" defaultValue={s.analytics_id} hint="Plausible: your site domain · GA4: G-XXXXXXX" />
              <Check name="cookie_consent_enabled" label="Ask for consent before loading analytics" defaultChecked={s.cookie_consent_enabled} />
              <Check name="maintenance_mode" label="Maintenance mode (public site shows the maintenance message)" defaultChecked={s.maintenance_mode} hint="Staff can still review pages with Preview." />
            </div>
            <div style={{ marginTop: 14 }}><SubmitButton>Save settings</SubmitButton></div>
          </ActionForm>
        </section>
      ) : null}

      {isAdmin ? (
        <section className="panel">
          <h2>Languages</h2>
          <p className="small muted">Adding a language needs no code changes: add it here, translate content in each editor (a new tab appears), then enable it.</p>
          {langs.map((l) => (
            <ActionForm key={l.code} action={updateLanguage}>
              <input type="hidden" name="code" value={l.code} />
              <div className="form-grid" style={{ gridTemplateColumns: "70px 1fr 1fr 90px auto auto auto", alignItems: "end", borderBottom: "1px solid var(--line)", paddingBottom: 10, marginBottom: 10 }}>
                <div className="mono" style={{ alignSelf: "center" }}>{l.code} · {l.dir}</div>
                <Text name="name" label="Name" defaultValue={l.name} />
                <Text name="native_name" label="Native name" defaultValue={l.native_name} dir={l.dir} />
                <Text name="sort_order" label="Order" type="number" defaultValue={l.sort_order} />
                <Check name="enabled" label="Enabled" defaultChecked={l.enabled} />
                <Check name="is_default" label="Default" defaultChecked={l.is_default} />
                <SubmitButton className="btn secondary small">Save</SubmitButton>
              </div>
            </ActionForm>
          ))}
          <ActionForm action={addLanguage} className="form-grid" resetOnSuccess>
            <Text name="code" label="New language code" placeholder="fr" maxLength={5} />
            <Text name="name" label="Name (English)" placeholder="French" />
            <Text name="native_name" label="Native name" placeholder="Français" />
            <Select name="dir" label="Direction" options={[{ value: "ltr", label: "Left-to-right" }, { value: "rtl", label: "Right-to-left" }]} />
            <div className="full"><SubmitButton className="btn secondary">Add language</SubmitButton></div>
          </ActionForm>
        </section>
      ) : null}

      {isAdmin ? (
        <section className="panel">
          <h2>Inquiry e-mail notifications</h2>
          {!mailer || !serviceKey ? <div className="flash warn">E-mail sending is not configured on the server yet (needs RESEND_API_KEY, NOTIFICATION_FROM_EMAIL and SUPABASE_SERVICE_ROLE_KEY — see README). Settings can be saved now.</div> : null}
          <ActionForm action={saveNotifications}>
            <div className="form-grid">
              <Check name="notifications_enabled" label="Send an e-mail when a new inquiry arrives" defaultChecked={p?.notifications_enabled} hint="The e-mail contains only the type, service, country and a link to the admin — no personal details." />
              <TextArea name="notification_emails" label="Recipients (comma or line separated)" defaultValue={(p?.notification_emails ?? []).join("\n")} rows={2} />
              <Check name="type_case" label="Case inquiries" defaultChecked={p?.notify_on_types?.includes("case") ?? true} />
              <Check name="type_partnership" label="Partnership inquiries" defaultChecked={p?.notify_on_types?.includes("partnership") ?? true} />
              <Check name="type_contact" label="Contact messages" defaultChecked={p?.notify_on_types?.includes("contact") ?? true} />
            </div>
            <SubmitButton>Save notifications</SubmitButton>
          </ActionForm>
        </section>
      ) : null}
    </>
  );
}
