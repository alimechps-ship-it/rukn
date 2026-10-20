import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Picture } from "@/components/site/Picture";
import { ServiceCard, priceLabel } from "@/components/site/Sections";
import { getService, getServices, getSite } from "@/lib/content";
import { localizeHref, makeT } from "@/lib/i18n";
import { RichText } from "@/lib/rich-text";
import { buildMetadata } from "@/lib/seo";

export const revalidate = 300;
export function generateStaticParams() { return []; }

type P = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { locale, slug } = await params;
  const [site, svc] = await Promise.all([getSite(locale), getService(slug, locale)]);
  if (!site || !svc) return {};
  return buildMetadata(site, {
    title: svc.tr.seo_title || svc.tr.title,
    description: svc.tr.seo_description || svc.tr.summary,
    path: `/services/${slug}`,
    image: svc.media,
  });
}

export default async function ServicePage({ params }: P) {
  const { locale, slug } = await params;
  const [site, svc, all] = await Promise.all([getSite(locale), getService(slug, locale), getServices(locale)]);
  if (!site || !svc) notFound();
  const t = makeT(site.strings);
  const ill = t("image.illustrative");
  const others = all.filter((s) => s.id !== svc.id).slice(0, 3);
  const cta = svc.cta_href || `/case-inquiry?service=${svc.slug}`;
  const price = priceLabel(svc, locale, t("services.price_from"));

  return (
    <>
      <section className="hero">
        <div className="container hero-grid">
          <div>
            <div className="eyebrow">{svc.tr.nav_title ?? t("footer.services")}</div>
            <h1>{svc.tr.title}</h1>
            <RichText text={svc.tr.description} className="lead" />
            {price ? <p className="price">{price}{svc.tr.price_note ? ` · ${svc.tr.price_note}` : ""}</p> : null}
            <div className="btn-row">
              <Link className="btn btn-teal" href={localizeHref(cta, locale)}>{svc.tr.cta_label ?? t("nav.cta")}</Link>
            </div>
          </div>
          <div className="hero-media">
            <div className="frame" style={{ position: "relative" }}>
              <Picture media={svc.media} priority sizes="(max-width: 900px) 100vw, 560px" illustrativeLabel={ill} />
            </div>
          </div>
        </div>
      </section>

      {svc.tr.features.length ? (
        <section className="section alt">
          <div className="container split text-only">
            <div>{svc.tr.features_heading ? <h2>{svc.tr.features_heading}</h2> : null}</div>
            <ul className="feature-list">{svc.tr.features.map((f, i) => <li key={i}>{f}</li>)}</ul>
          </div>
        </section>
      ) : null}

      {svc.tr.workflow.length ? (
        <section className="section">
          <div className="container">
            {svc.tr.workflow_heading ? <div className="section-head"><h2>{svc.tr.workflow_heading}</h2></div> : null}
            <ol className="steps">{svc.tr.workflow.map((w, i) => <li key={i}><h3>{w.title}</h3>{w.text ? <p>{w.text}</p> : null}</li>)}</ol>
          </div>
        </section>
      ) : null}

      {svc.tr.notice ? (
        <section className="section" style={{ paddingBlock: "8px 32px" }}>
          <div className="container"><div className="notice" role="note"><p>{svc.tr.notice}</p></div></div>
        </section>
      ) : null}

      {svc.gallery.length ? (
        <section className="section alt">
          <div className="container">
            <div className="gallery">
              {svc.gallery.map((m) => <figure key={m.id}><Picture media={m} sizes="(max-width: 760px) 100vw, 66vw" illustrativeLabel={ill} /></figure>)}
            </div>
          </div>
        </section>
      ) : null}

      <section className="section">
        <div className="container">
          <div className="cta-band">
            <h2>{svc.tr.title}</h2>
            {svc.tr.summary ? <p>{svc.tr.summary}</p> : null}
            <div className="btn-row"><Link className="btn btn-light" href={localizeHref(cta, locale)}>{svc.tr.cta_label ?? t("nav.cta")}</Link></div>
          </div>
        </div>
      </section>

      {others.length ? (
        <section className="section alt">
          <div className="container">
            <div className="section-head"><h2>{t("services.related")}</h2></div>
            <div className="grid grid-3">{others.map((o) => <ServiceCard key={o.id} s={o} locale={locale} t={t} />)}</div>
          </div>
        </section>
      ) : null}
    </>
  );
}
