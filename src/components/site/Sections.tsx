import Link from "next/link";
import { getFaqs, getMediaByIds, getServices, getTeam } from "@/lib/content";
import { localizeHref } from "@/lib/i18n";
import { RichText } from "@/lib/rich-text";
import type { PageData, Section, Service, SiteData } from "@/lib/types";
import { InquiryForm } from "./InquiryForm";
import { Clock, Info, itemIcon, Mail, MapPin, serviceIcon, Share2, SocialIcon, WhatsAppIcon } from "@/components/icons";
import { Picture } from "./Picture";

interface Ctx {
  site: SiteData;
  page: PageData;
  t: (k: string) => string;
}

const FORM_KEYS = [
  "form.name", "form.email", "form.country", "form.organization", "form.phone", "form.role", "form.role.select",
  "form.role.dentist", "form.role.orthodontist", "form.role.technician", "form.role.lab", "form.role.clinic_manager",
  "form.role.distributor", "form.role.other", "form.service", "form.service.select", "form.service.general",
  "form.message", "form.message.case_hint", "form.consent", "form.required", "form.submit", "form.submitting",
  "form.success_title", "form.success", "form.error.validation", "form.error.rate_limited", "form.error.generic",
  "form.error.captcha", "form.error.name", "form.error.email", "form.error.consent", "form.error.message",
];

function Buttons({ s, locale, dark = false }: { s: Section; locale: string; dark?: boolean }) {
  const { primary_label, primary_href, secondary_label, secondary_href } = s.tr;
  if (!primary_label && !secondary_label) return null;
  return (
    <div className="btn-row">
      {primary_label ? <Link className={dark ? "btn btn-light" : "btn btn-teal"} href={localizeHref(primary_href, locale)}>{primary_label}</Link> : null}
      {secondary_label ? <Link className={dark ? "btn btn-ghost-light" : "btn btn-outline"} href={localizeHref(secondary_href, locale)}>{secondary_label}</Link> : null}
    </div>
  );
}

function Head({ s, center = false, as: H = "h2" }: { s: Section; center?: boolean; as?: "h1" | "h2" }) {
  if (!s.tr.eyebrow && !s.tr.heading && !s.tr.subheading) return null;
  return (
    <div className={`section-head${center ? " center" : ""}`}>
      {s.tr.eyebrow ? <div className="eyebrow">{s.tr.eyebrow}</div> : null}
      {s.tr.heading ? <H>{s.tr.heading}</H> : null}
      {s.tr.subheading ? <p className="lead">{s.tr.subheading}</p> : null}
    </div>
  );
}

export function priceLabel(s: Service, locale: string, from: string) {
  if (!s.show_price || s.price_amount === null || !s.price_currency) return null;
  const formatted = new Intl.NumberFormat(locale, { style: "currency", currency: s.price_currency, maximumFractionDigits: 0 }).format(s.price_amount);
  return `${from} ${formatted}`;
}

export function ServiceCard({ s, locale, t }: { s: Service; locale: string; t: (k: string) => string }) {
  const price = priceLabel(s, locale, t("services.price_from"));
  const Icon = serviceIcon(s.slug);
  return (
    <Link href={`/${locale}/services/${s.slug}`} className="service-card">
      <div className="media">
        <Picture media={s.media} sizes="(max-width: 640px) 100vw, (max-width: 1020px) 50vw, 400px" illustrativeLabel={t("image.illustrative")} />
      </div>
      <div className="body">
        <span className="icon-badge" aria-hidden="true"><Icon size={22} strokeWidth={1.8} /></span>
        <h3>{s.tr.nav_title ?? s.tr.title}</h3>
        {s.tr.summary ? <p>{s.tr.summary}</p> : null}
        {price ? <div className="price">{price}{s.tr.price_note ? ` · ${s.tr.price_note}` : ""}</div> : null}
        <span className="link-arrow">{t("services.learn_more")}</span>
      </div>
    </Link>
  );
}

async function SectionView({ s, ctx, index }: { s: Section; ctx: Ctx; index: number }) {
  const { site, t, page } = ctx;
  const locale = site.locale;
  const ill = t("image.illustrative");
  const settings = s.settings as Record<string, unknown>;

  switch (s.type) {
    case "hero": {
      if (settings.compact || !s.media) {
        return (
          <section className="page-hero">
            <div className="container">
              {page.needs_legal_review && index === 0 ? <div className="legal-banner">{t("legal.review_banner")}</div> : null}
              {s.tr.eyebrow ? <div className="eyebrow">{s.tr.eyebrow}</div> : null}
              <h1>{s.tr.heading ?? page.title}</h1>
              {s.tr.subheading ? <p className="lead">{s.tr.subheading}</p> : null}
              <RichText text={s.tr.body} />
              <Buttons s={s} locale={locale} />
            </div>
          </section>
        );
      }
      return (
        <section className="hero">
          <div className="container hero-grid">
            <div>
              {s.tr.eyebrow ? <div className="eyebrow">{s.tr.eyebrow}</div> : null}
              <h1>{s.tr.heading}</h1>
              {s.tr.subheading ? <p className="lead">{s.tr.subheading}</p> : null}
              <Buttons s={s} locale={locale} />
            </div>
            <div className="hero-media">
              <div className="frame" style={{ position: "relative" }}>
                <Picture media={s.media} priority sizes="(max-width: 900px) 100vw, 560px" illustrativeLabel={ill} />
              </div>
            </div>
          </div>
        </section>
      );
    }

    case "services_grid": {
      const all = await getServices(locale);
      const list = settings.featured_only ? all.filter((x) => x.is_featured) : all;
      if (!list.length) return null;
      return (
        <section className={`section${index % 2 ? " alt" : ""}`}>
          <div className="container">
            <Head s={s} />
            <div className={`grid ${list.length >= 4 ? "grid-4" : list.length === 2 ? "grid-2" : "grid-3"}`}>
              {list.map((svc) => <ServiceCard key={svc.id} s={svc} locale={locale} t={t} />)}
            </div>
            {s.tr.primary_label ? (
              <p style={{ marginTop: 28 }}><Link className="link-arrow" href={localizeHref(s.tr.primary_href, locale)}>{s.tr.primary_label}</Link></p>
            ) : null}
          </div>
        </section>
      );
    }

    case "image_text":
      return (
        <section className={`section${index % 2 ? " alt" : ""}`}>
          <div className="container split">
            <div className="frame"><Picture media={s.media} sizes="(max-width: 860px) 100vw, 560px" illustrativeLabel={ill} /></div>
            <div>
              {s.tr.eyebrow ? <div className="eyebrow">{s.tr.eyebrow}</div> : null}
              {s.tr.heading ? <h2>{s.tr.heading}</h2> : null}
              <RichText text={s.tr.body} />
              {s.tr.primary_label ? <Link className="link-arrow" href={localizeHref(s.tr.primary_href, locale)}>{s.tr.primary_label}</Link> : null}
            </div>
          </div>
        </section>
      );

    case "rich_text":
      return (
        <section className={`section${index % 2 ? " alt" : ""}`}>
          <div className={`container${settings.layout === "split" ? " split text-only" : ""}`}>
            {page.needs_legal_review && s.tr.eyebrow ? <div className="legal-banner">{t("legal.review_banner")}</div> : null}
            <div>
              {s.tr.eyebrow && !page.needs_legal_review ? <div className="eyebrow">{s.tr.eyebrow}</div> : null}
              {s.tr.heading ? (index === 0 ? <h1>{s.tr.heading}</h1> : <h2>{s.tr.heading}</h2>) : null}
            </div>
            <div>
              <RichText text={s.tr.body} />
              <Buttons s={s} locale={locale} />
            </div>
          </div>
        </section>
      );

    case "steps":
      if (!s.tr.items.length) return null;
      return (
        <section className={`section${index % 2 ? " alt" : ""}`}>
          <div className="container">
            <Head s={s} />
            <ol className="steps">
              {s.tr.items.map((it, i) => (
                <li key={i}><h3>{it.title}</h3>{it.text ? <p>{it.text}</p> : null}</li>
              ))}
            </ol>
          </div>
        </section>
      );

    case "cards":
    case "benefits":
      if (!s.tr.items.length) return null;
      return (
        <section className={`section${index % 2 ? " alt" : ""}`}>
          <div className="container">
            <Head s={s} />
            <div className={`grid ${s.tr.items.length === 4 ? "grid-4" : s.tr.items.length === 2 ? "grid-2" : "grid-3"}`}>
              {s.tr.items.map((it, i) => {
                const Icon = itemIcon(it.icon, it.title);
                return (
                <div className="card" key={i}>
                  <span className="icon-tile" aria-hidden="true"><Icon size={24} strokeWidth={1.7} /></span>
                  <h3>{it.title}</h3>
                  {it.text ? <p>{it.text}</p> : null}
                </div>
                );
              })}
            </div>
            <Buttons s={s} locale={locale} />
          </div>
        </section>
      );

    case "gallery": {
      const ids = Array.isArray(settings.media_ids) ? (settings.media_ids as string[]).filter((x) => typeof x === "string") : [];
      const media = await getMediaByIds(ids.join(","), locale);
      if (!media.length) return null;
      return (
        <section className={`section${index % 2 ? " alt" : ""}`}>
          <div className="container">
            <Head s={s} />
            <div className={`gallery n-${Math.min(media.length, 6)}`}>
              {media.map((m) => (
                <figure key={m.id}>
                  <Picture media={m} sizes="(max-width: 760px) 100vw, 66vw" illustrativeLabel={ill} />
                </figure>
              ))}
            </div>
          </div>
        </section>
      );
    }

    case "faq": {
      const faqs = await getFaqs(locale, typeof settings.topic === "string" ? settings.topic : "general");
      if (!faqs.length) return null;
      const jsonLd = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } })),
      };
      return (
        <section className={`section${index % 2 ? " alt" : ""}`}>
          <div className="container">
            <Head s={s} center />
            <div className="faq">
              {faqs.map((f) => (
                <details key={f.id}>
                  <summary>{f.question}</summary>
                  <div className="answer"><RichText text={f.answer} className="" /></div>
                </details>
              ))}
            </div>
          </div>
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
        </section>
      );
    }

    case "cta":
      return (
        <section className="section">
          <div className="container">
            <div className="cta-band">
              {s.tr.eyebrow ? <div className="eyebrow">{s.tr.eyebrow}</div> : null}
              {s.tr.heading ? <h2>{s.tr.heading}</h2> : null}
              {s.tr.body ? <p>{s.tr.body}</p> : null}
              <Buttons s={s} locale={locale} dark />
            </div>
          </div>
        </section>
      );

    case "notice":
      return (
        <section className="section" style={{ paddingBlock: "32px 0" }}>
          <div className="container">
            <div className="notice" role="note">
              <span className="notice-icon" aria-hidden="true"><Info size={22} strokeWidth={1.8} /></span>
              <div>
                {s.tr.heading ? <h2>{s.tr.heading}</h2> : null}
                {s.tr.body ? <p>{s.tr.body}</p> : null}
              </div>
            </div>
          </div>
        </section>
      );

    case "team": {
      const team = await getTeam(locale);
      return (
        <section className={`section${index % 2 ? " alt" : ""}`}>
          <div className="container">
            <Head s={s} />
            {s.tr.body ? <RichText text={s.tr.body} /> : null}
            {team.length ? (
              <div className="grid grid-4" style={{ marginTop: 24 }}>
                {team.map((m) => (
                  <div className="team-card" key={m.id}>
                    <div className="photo"><Picture media={m.photo} sizes="300px" /></div>
                    <h3>{m.name}</h3>
                    {m.role_title ? <div className="role">{m.role_title}</div> : null}
                    {m.bio ? <p style={{ color: "var(--muted)", fontSize: ".95rem" }}>{m.bio}</p> : null}
                    {m.linkedin_url ? <a href={m.linkedin_url} rel="noopener noreferrer" target="_blank">LinkedIn</a> : null}
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ color: "var(--muted)" }}>{t("team.empty")}</p>
            )}
          </div>
        </section>
      );
    }

    case "contact_details": {
      const st = site.settings;
      const tr = site.settingsTr;
      const wa = st.whatsapp_number ? `https://wa.me/${st.whatsapp_number.replace(/\D/g, "")}` : null;
      const rows = [
        st.contact_email ? { icon: <Mail size={22} strokeWidth={1.8} />, label: t("contact.email"), node: <a href={`mailto:${st.contact_email}`}><bdi>{st.contact_email}</bdi></a> } : null,
        wa ? { icon: <WhatsAppIcon size={22} />, label: t("contact.whatsapp"), node: <a href={wa} target="_blank" rel="noopener noreferrer"><bdi dir="ltr">{st.whatsapp_number}</bdi></a> } : null,
        tr.location_text ? { icon: <MapPin size={22} strokeWidth={1.8} />, label: t("contact.location"), node: <span>{tr.location_text}</span> } : null,
        tr.business_hours ? { icon: <Clock size={22} strokeWidth={1.8} />, label: t("contact.hours"), node: <span style={{ whiteSpace: "pre-line" }}>{tr.business_hours}</span> } : null,
        st.social_links.length
          ? { icon: <Share2 size={22} strokeWidth={1.8} />, label: t("contact.social"), node: <span className="social-row">{st.social_links.map((l) => <a key={l.url} className="social-btn" href={l.url} target="_blank" rel="noopener noreferrer" aria-label={l.network} title={l.network}><SocialIcon url={l.url} name={l.network} /></a>)}</span> }
          : null,
      ].filter(Boolean) as { icon: React.ReactNode; label: string; node: React.ReactNode }[];
      return (
        <section className="section" style={{ paddingBottom: 0 }}>
          <div className="container">
            {s.tr.heading ? <h2>{s.tr.heading}</h2> : null}
            {rows.length ? (
              <ul className="contact-list grid grid-3">
                {rows.map((r) => <li key={r.label}><span className="contact-icon" aria-hidden="true">{r.icon}</span><div><span className="label">{r.label}</span>{r.node}</div></li>)}
              </ul>
            ) : (
              <p style={{ color: "var(--muted)" }}>{t("contact.none")}</p>
            )}
          </div>
        </section>
      );
    }

    case "inquiry_form": {
      const form = (["contact", "case", "partnership"] as const).find((f) => f === settings.form) ?? "contact";
      const services = (await getServices(locale)).map((x) => ({ slug: x.slug, label: x.tr.nav_title ?? x.tr.title }));
      const strings = Object.fromEntries(FORM_KEYS.map((k) => [k, t(k)]));
      return (
        <section className="section" id="form">
          <div className="container split text-only">
            <div>
              {s.tr.heading ? <h2>{s.tr.heading}</h2> : null}
              <RichText text={s.tr.body} />
            </div>
            <InquiryForm
              type={form}
              locale={locale}
              source={`/${locale}/${page.slug}`}
              strings={strings}
              services={services}
              privacyHref={`/${locale}/privacy-policy`}
              successInstructions={site.settingsTr.case_submission_instructions}
            />
          </div>
        </section>
      );
    }

    default:
      return null;
  }
}

export async function Sections({ ctx }: { ctx: Ctx }) {
  return (
    <>
      {ctx.page.sections.map((s, i) => (
        <SectionView key={s.id} s={s} ctx={ctx} index={i} />
      ))}
    </>
  );
}
