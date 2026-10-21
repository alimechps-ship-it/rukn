import "server-only";
import type { Db } from "@/lib/admin";
import type { Company } from "./PrintShell";

export async function loadCompany(db: Db): Promise<Company> {
  const [{ data: s }, { data: t }] = await Promise.all([
    db.from("site_settings").select("site_name,contact_email,whatsapp_number").eq("id", 1).maybeSingle(),
    db.from("site_settings_translations").select("location_text").eq("locale", "en").maybeSingle(),
  ]);
  return { name: s?.site_name ?? "RUKN", email: s?.contact_email ?? null, phone: s?.whatsapp_number ?? null, location: t?.location_text ?? null, logo: "/rukn-logo.png" };
}
