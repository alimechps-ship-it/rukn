import "./print.css";
import { PrintButton } from "./PrintButton";

export interface Company { name: string; email: string | null; phone: string | null; location: string | null; logo: string }

export function PrintShell({ children, back, company, docRef }: { children: React.ReactNode; back: string; company: Company; docRef: string }) {
  const now = new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Cairo" });
  return (
    <>
      <div className="toolbar"><PrintButton /><a className="ghost" href={back}>← Back</a></div>
      <div className="sheet">
        <div className="doc-head">
          <img src={company.logo} alt={company.name} />
          <div className="company">
            <strong style={{ color: "#10263d", fontSize: "11pt" }}>{company.name}</strong><br />
            {company.location ? <>{company.location}<br /></> : null}
            {company.email ? <>{company.email}<br /></> : null}
            {company.phone ? <bdi dir="ltr">{company.phone}</bdi> : null}
          </div>
        </div>
        {children}
        <div className="foot"><span>{company.name} · {docRef}</span><span>Printed {now}</span></div>
      </div>
    </>
  );
}
