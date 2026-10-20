"use client";

import Script from "next/script";
import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { submitInquiry, type InquiryState } from "@/app/(site)/actions";

type FormType = "contact" | "case" | "partnership";
const ROLES = ["dentist", "orthodontist", "technician", "lab", "clinic_manager", "distributor", "other"];

interface Props {
  type: FormType;
  locale: string;
  source: string;
  strings: Record<string, string>;
  services: { slug: string; label: string }[];
  defaultService?: string;
  privacyHref: string;
  successInstructions?: string | null;
}

function Submit({ label, pending }: { label: string; pending: string }) {
  const { pending: isPending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-teal" disabled={isPending} aria-busy={isPending}>
      {isPending ? pending : label}
    </button>
  );
}

export function InquiryForm({ type, locale, source, strings, services, defaultService, privacyHref, successInstructions }: Props) {
  const t = (k: string) => strings[k] ?? k;
  const [state, action] = useActionState<InquiryState, FormData>(submitInquiry, { status: "idle" });
  const [ts, setTs] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const turnstileKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  const [preselect, setPreselect] = useState(defaultService ?? "");
  useEffect(() => {
    setTs(Date.now());
    const wanted = new URLSearchParams(window.location.search).get("service");
    if (wanted && services.some((s) => s.slug === wanted)) setPreselect(wanted);
  }, [services]);
  useEffect(() => {
    if (state.status !== "idle") panelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [state]);

  if (state.status === "success") {
    return (
      <div className="form-card success-panel" ref={panelRef} role="status" aria-live="polite">
        <h3>{t("form.success_title")}</h3>
        <p>{type === "case" && successInstructions ? successInstructions : t("form.success")}</p>
      </div>
    );
  }

  const fe = state.status === "error" ? state.fieldErrors ?? {} : {};
  const vals = state.status === "error" ? state.values ?? {} : {};
  const v = (k: string) => vals[k] ?? "";
  const err = (k: string) => (fe[k] ? <div className="error" id={`${type}-${k}-err`}>{t(fe[k])}</div> : null);
  const aria = (k: string) => (fe[k] ? { "aria-invalid": true as const, "aria-describedby": `${type}-${k}-err` } : {});
  const id = (k: string) => `${type}-${k}`;
  const req = <span className="req" aria-hidden="true">*</span>;

  const needCountry = type !== "contact";
  const needRole = type === "case";
  const needOrg = type === "partnership";
  const needMessage = type !== "case";

  return (
    <div className="form-card" ref={panelRef}>
      {state.status === "error" ? <div className="alert alert-error" role="alert">{t(state.messageKey)}</div> : null}
      <form action={action} noValidate={false}>
        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="source" value={source} />
        <input type="hidden" name="ts" value={ts} />
        <div className="hp" aria-hidden="true">
          <label htmlFor={id("website")}>Website</label>
          <input id={id("website")} name="website" type="text" tabIndex={-1} autoComplete="off" />
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor={id("name")}>{t("form.name")} {req}</label>
            <input id={id("name")} name="name" defaultValue={v("name")} required minLength={2} maxLength={120} autoComplete="name" {...aria("name")} />
            {err("name")}
          </div>
          <div className="field">
            <label htmlFor={id("email")}>{t("form.email")} {req}</label>
            <input id={id("email")} name="email" defaultValue={v("email")} type="email" required maxLength={200} autoComplete="email" dir="ltr" {...aria("email")} />
            {err("email")}
          </div>
          <div className="field">
            <label htmlFor={id("country")}>{t("form.country")} {needCountry ? req : null}</label>
            <input id={id("country")} name="country" defaultValue={v("country")} required={needCountry} maxLength={80} autoComplete="country-name" {...aria("country")} />
            {err("country")}
          </div>
          <div className="field">
            <label htmlFor={id("organization")}>{t("form.organization")} {needOrg ? req : null}</label>
            <input id={id("organization")} name="organization" defaultValue={v("organization")} required={needOrg} maxLength={160} autoComplete="organization" {...aria("organization")} />
            {err("organization")}
          </div>
          <div className="field">
            <label htmlFor={id("role")}>{t("form.role")} {needRole ? req : null}</label>
            <select id={id("role")} name="role" required={needRole} defaultValue={v("role")} {...aria("role")}>
              <option value="">{t("form.role.select")}</option>
              {ROLES.map((r) => <option key={r} value={r}>{t(`form.role.${r}`)}</option>)}
            </select>
            {err("role")}
          </div>
          {type === "case" ? (
            <div className="field">
              <label htmlFor={id("phone")}>{t("form.phone")}</label>
              <input id={id("phone")} name="phone" defaultValue={v("phone")} type="tel" maxLength={40} autoComplete="tel" dir="ltr" />
            </div>
          ) : null}
          {type !== "partnership" ? (
            <div className={`field ${type === "case" ? "full" : ""}`}>
              <label htmlFor={id("service")}>{t("form.service")} {type === "case" ? req : null}</label>
              <select key={preselect} id={id("service")} name="service" required={type === "case"} defaultValue={v("service") || preselect} {...aria("service")}>
                <option value="">{type === "case" ? t("form.service.select") : t("form.service.general")}</option>
                {services.map((s) => <option key={s.slug} value={s.slug}>{s.label}</option>)}
              </select>
              {err("service")}
            </div>
          ) : null}
          <div className="field full">
            <label htmlFor={id("message")}>{t("form.message")} {needMessage ? req : null}</label>
            <textarea id={id("message")} name="message" defaultValue={v("message")} required={needMessage} maxLength={4000} {...aria("message")} />
            {type === "case" ? <div className="hint">{t("form.message.case_hint")}</div> : null}
            {err("message")}
          </div>
          <div className="field full">
            <label className="check">
              <input type="checkbox" name="consent" required {...aria("consent")} />
              <span>
                {t("form.consent")} <a href={privacyHref} target="_blank" rel="noopener">↗</a>
              </span>
            </label>
            {err("consent")}
          </div>
          {turnstileKey ? (
            <div className="full">
              <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
              <div className="cf-turnstile" data-sitekey={turnstileKey} data-language={locale} />
            </div>
          ) : null}
          <div className="full">
            <Submit label={t("form.submit")} pending={t("form.submitting")} />
          </div>
        </div>
      </form>
    </div>
  );
}
