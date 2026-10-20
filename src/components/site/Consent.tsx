"use client";
import Script from "next/script";
import { useEffect, useState } from "react";

const KEY = "rukn_consent"; // "analytics" | "essential"

interface Props {
  provider: "plausible" | "ga4" | null;
  analyticsId: string | null;
  consentRequired: boolean;
  domain: string;
  text: string | null;
  acceptLabel: string;
  declineLabel: string;
}

/** Loads analytics only when configured and (if required) after the visitor allows it. */
export function Consent({ provider, analyticsId, consentRequired, domain, text, acceptLabel, declineLabel }: Props) {
  const [choice, setChoice] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try { setChoice(window.localStorage.getItem(KEY)); } catch { /* storage unavailable */ }
    setReady(true);
  }, []);

  const save = (v: string) => {
    try { window.localStorage.setItem(KEY, v); } catch { /* ignore */ }
    setChoice(v);
  };

  if (!provider || !analyticsId) return null;
  const allowed = !consentRequired || choice === "analytics";

  return (
    <>
      {allowed && provider === "plausible" ? (
        <Script defer data-domain={analyticsId || domain} src="https://plausible.io/js/script.js" strategy="afterInteractive" />
      ) : null}
      {allowed && provider === "ga4" ? (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(analyticsId)}`} strategy="afterInteractive" />
          <Script id="ga4" strategy="afterInteractive">{`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config',${JSON.stringify(analyticsId)},{anonymize_ip:true});`}</Script>
        </>
      ) : null}
      {ready && consentRequired && !choice ? (
        <div className="cookie" role="dialog" aria-live="polite">
          {text ? <p style={{ margin: 0 }}>{text}</p> : null}
          <div className="btn-row">
            <button type="button" className="btn btn-teal" onClick={() => save("analytics")}>{acceptLabel}</button>
            <button type="button" className="btn btn-outline" onClick={() => save("essential")}>{declineLabel}</button>
          </div>
        </div>
      ) : null}
    </>
  );
}
