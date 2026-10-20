"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { z } from "zod";
import { createPublicClient } from "@/lib/supabase/public";
import { createServiceClient } from "@/lib/supabase/service";

export type InquiryState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; messageKey: string; fieldErrors?: Record<string, string>; values?: Record<string, string> };

const ROLES = ["dentist", "orthodontist", "technician", "lab", "clinic_manager", "distributor", "other"] as const;

const base = z.object({
  type: z.enum(["contact", "case", "partnership"]),
  locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
  source: z.string().max(300).optional().default(""),
  name: z.string().trim().min(2, "form.error.name").max(120, "form.error.name"),
  email: z.string().trim().max(200).email("form.error.email"),
  country: z.string().trim().max(80).optional().default(""),
  organization: z.string().trim().max(160).optional().default(""),
  role: z.union([z.enum(ROLES), z.literal("")]).optional().default(""),
  phone: z.string().trim().max(40).optional().default(""),
  service: z.string().trim().max(80).regex(/^[a-z0-9-]*$/).optional().default(""),
  message: z.string().trim().max(4000, "form.error.message").optional().default(""),
  consent: z.literal("on", { errorMap: () => ({ message: "form.error.consent" }) }),
});

function requiredFor(type: string, data: z.infer<typeof base>): Record<string, string> {
  const e: Record<string, string> = {};
  if (type === "case") {
    if (!data.country) e.country = "form.required";
    if (!data.role) e.role = "form.required";
    if (!data.service) e.service = "form.required";
  }
  if (type === "partnership") {
    if (!data.country) e.country = "form.required";
    if (!data.organization) e.organization = "form.required";
    if (!data.message) e.message = "form.required";
  }
  if (type === "contact" && !data.message) e.message = "form.required";
  return e;
}

async function verifyTurnstile(token: string | null, ip: string) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret || !process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) return true; // not configured
  if (!token) return false;
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: new URLSearchParams({ secret, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(8000),
    });
    const json = (await res.json()) as { success?: boolean };
    return json.success === true;
  } catch {
    return false;
  }
}

async function notify(type: string, data: z.infer<typeof base>, id: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFICATION_FROM_EMAIL;
  const svc = createServiceClient();
  if (!apiKey || !from || !svc) return;
  const { data: cfg } = await svc.from("private_settings").select("*").eq("id", 1).maybeSingle();
  if (!cfg?.notifications_enabled || !cfg.notification_emails?.length || !cfg.notify_on_types?.includes(type)) return;
  const site = (process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "")).replace(/\/$/, "");
  // Only the minimum is e-mailed; full details stay behind the admin login.
  const text = [
    `New ${type} inquiry received on the RUKN website.`,
    `Service: ${data.service || "—"}`,
    `Country: ${data.country || "—"}`,
    "",
    site ? `Open it in the admin dashboard: ${site}/admin/inquiries/${id}` : `Inquiry ID: ${id}`,
  ].join("\n");
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: cfg.notification_emails, subject: `New ${type} inquiry — RUKN website`, text }),
    signal: AbortSignal.timeout(8000),
  }).catch((err) => console.error("[inquiry] notification failed", err));
}

export async function submitInquiry(_prev: InquiryState, formData: FormData): Promise<InquiryState> {
  // Honeypot: real visitors never see or fill this field.
  if (String(formData.get("website") ?? "").length > 0) return { status: "success" };

  const startedAt = Number(formData.get("ts") ?? 0);
  const values = Object.fromEntries(
    ["name", "email", "country", "organization", "role", "phone", "service", "message"].map((k) => [k, String(formData.get(k) ?? "").slice(0, 4000)]),
  );
  if (!startedAt || Date.now() - startedAt < 1500) return { status: "error", messageKey: "form.error.generic", values };
  const raw = Object.fromEntries(
    ["type", "locale", "source", "name", "email", "country", "organization", "role", "phone", "service", "message", "consent"].map((k) => [k, formData.get(k) ?? undefined]),
  );
  const parsed = base.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const k = String(issue.path[0]);
      if (!fieldErrors[k]) fieldErrors[k] = issue.message.startsWith("form.") ? issue.message : "form.error.validation";
    }
    return { status: "error", messageKey: "form.error.validation", fieldErrors, values };
  }
  const data = parsed.data;
  const missing = requiredFor(data.type, data);
  if (Object.keys(missing).length) return { status: "error", messageKey: "form.error.validation", fieldErrors: missing, values };

  const h = await headers();
  const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim();
  if (!(await verifyTurnstile(formData.get("cf-turnstile-response") as string | null, ip))) {
    return { status: "error", messageKey: "form.error.captcha", values };
  }
  const salt = process.env.INQUIRY_HASH_SALT ?? "";
  const clientKey = ip ? createHash("sha256").update(`${salt}:${ip}`).digest("hex") : null;

  const { data: id, error } = await createPublicClient().rpc("submit_inquiry", {
    p_type: data.type,
    p_name: data.name,
    p_email: data.email,
    p_country: data.country,
    p_organization: data.organization,
    p_professional_role: data.role,
    p_phone: data.phone,
    p_service_slug: data.service,
    p_message: data.message,
    p_locale: data.locale,
    p_source_path: data.source,
    p_consent: true,
    p_client_key: clientKey,
  });

  if (error) {
    if (error.code === "P0429") return { status: "error", messageKey: "form.error.rate_limited", values };
    if (error.code === "22023") return { status: "error", messageKey: "form.error.validation", values };
    console.error("[inquiry] submit failed", error.code, error.message);
    return { status: "error", messageKey: "form.error.generic", values };
  }

  await notify(data.type, data, String(id));
  return { status: "success" };
}
