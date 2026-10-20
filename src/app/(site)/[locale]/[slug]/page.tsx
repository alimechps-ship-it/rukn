import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Sections } from "@/components/site/Sections";
import { getPage, getSite } from "@/lib/content";
import { makeT } from "@/lib/i18n";
import { buildMetadata } from "@/lib/seo";

export const revalidate = 300;
export function generateStaticParams() { return []; }

type P = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { locale, slug } = await params;
  const [site, page] = await Promise.all([getSite(locale), getPage(slug, locale)]);
  if (!site || !page) return {};
  return buildMetadata(site, { title: page.seo_title || page.title, description: page.seo_description, path: `/${slug}`, image: page.ogImage });
}

export default async function CmsPage({ params }: P) {
  const { locale, slug } = await params;
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) notFound();
  const [site, page] = await Promise.all([getSite(locale), getPage(slug, locale)]);
  if (!site || !page) notFound();
  return <Sections ctx={{ site, page, t: makeT(site.strings) }} />;
}
