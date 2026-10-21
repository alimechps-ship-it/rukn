import "server-only";
import type { Db } from "./admin";

export async function serviceOptions(db: Db) {
  const { data } = await db.from("services").select("id,slug,status,service_translations(locale,variant,title,nav_title)").is("deleted_at", null).neq("status", "archived").order("sort_order");
  return (data ?? []).map((s) => {
    const tr = (s.service_translations as { locale: string; variant: string; title: string; nav_title: string | null }[]).find((t) => t.locale === "en" && t.variant === "published")
      ?? (s.service_translations as { locale: string; title: string; nav_title: string | null }[])[0];
    return { id: s.id as string, label: tr?.nav_title ?? tr?.title ?? (s.slug as string) };
  });
}

/** People with a given role (case staff only can list these). */
export async function peopleWithRole(db: Db, roles: string[]) {
  const { data: r } = await db.from("user_roles").select("user_id,role");
  const ids = [...new Set((r ?? []).filter((x) => roles.includes(x.role as string)).map((x) => x.user_id as string))];
  if (!ids.length) return [];
  const { data } = await db.from("profiles").select("id,email,full_name,country,organization,is_active").in("id", ids).eq("is_active", true).order("full_name");
  return (data ?? []).map((p) => ({
    id: p.id as string,
    label: `${p.full_name || p.email}${p.organization ? ` · ${p.organization}` : ""}${p.country ? ` · ${p.country}` : ""}`,
    name: (p.full_name || p.email) as string,
  }));
}

export async function profileMap(db: Db, ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter(Boolean))] as string[];
  if (!list.length) return new Map<string, { name: string; email: string; phone: string | null; country: string | null; organization: string | null; region: string | null }>();
  const { data } = await db.from("profiles").select("id,email,full_name,phone,country,organization,region").in("id", list);
  return new Map((data ?? []).map((p) => [p.id as string, { name: (p.full_name || p.email) as string, email: p.email as string, phone: p.phone as string | null, country: p.country as string | null, organization: p.organization as string | null, region: p.region as string | null }]));
}
