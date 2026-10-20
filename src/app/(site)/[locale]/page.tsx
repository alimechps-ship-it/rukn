import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Sections } from "@/components/site/Sections";
import { getPage, getSite } from "@/lib/content";
import { makeT } from "@/lib/i18n";
import { buildMetadata } from "@/lib/seo";

export const revalidate = 300;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const [site, page] = await Promise.all([getSite(locale), getPage("", locale)]);
  if (!site || !page) return {};
  return buildMetadata(site, { title: page.seo_title, description: page.seo_description, path: "/", image: page.ogImage });
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const [site, page] = await Promise.all([getSite(locale), getPage("", locale)]);
  if (!site || !page) notFound();
  return <Sections ctx={{ site, page, t: makeT(site.strings) }} />;
}
