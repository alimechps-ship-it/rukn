import { Fragment, type ReactNode } from "react";

/**
 * Minimal, safe rich-text renderer for CMS text. Supports:
 *   blank line = new paragraph, "## " = sub-heading, "- " = bullet list,
 *   **bold**. No raw HTML is ever rendered (no XSS surface).
 */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>,
  );
}

export function RichText({ text, className }: { text: string | null | undefined; className?: string }) {
  if (!text) return null;
  const blocks = text.replace(/\r\n/g, "\n").split(/\n{2,}/);
  const out: ReactNode[] = [];
  blocks.forEach((block, bi) => {
    const lines = block.split("\n").filter((l) => l.trim().length);
    let list: string[] = [];
    let para: string[] = [];
    const flushList = () => {
      if (list.length) out.push(<ul key={`l${bi}-${out.length}`}>{list.map((li, i) => <li key={i}>{inline(li)}</li>)}</ul>);
      list = [];
    };
    const flushPara = () => {
      if (para.length) out.push(<p key={`p${bi}-${out.length}`}>{inline(para.join(" "))}</p>);
      para = [];
    };
    for (const line of lines) {
      if (line.startsWith("## ")) { flushList(); flushPara(); out.push(<h2 key={`h${bi}-${out.length}`}>{inline(line.slice(3))}</h2>); }
      else if (/^[-•]\s+/.test(line)) { flushPara(); list.push(line.replace(/^[-•]\s+/, "")); }
      else { flushList(); para.push(line); }
    }
    flushList();
    flushPara();
  });
  return <div className={className ?? "prose"}>{out}</div>;
}
