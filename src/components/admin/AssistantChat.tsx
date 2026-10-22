"use client";

import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

type Msg = { role: "user" | "assistant"; content: string; tools?: string[]; error?: boolean };
const KEY = "rukn-assistant-chat";

const OPS_SUGGESTIONS = [
  "كم حالة مفتوحة الآن حسب الحالة؟",
  "ما الحالات التي تنتظر موافقة الطبيب؟",
  "كم حالة جديدة هذا الشهر حسب الدولة؟",
];
const SUGGESTIONS = [
  "كم المستحق على كل مندوب؟",
  "ما الفواتير المتأخرة أكثر من 30 يوم؟",
  "ما رصيد كل صندوق الآن؟",
  "ما إشعارات الدفع التي تنتظر التأكيد؟ وهل الإيصالات مطابقة؟",
  "كم حالة جديدة هذا الشهر حسب الدولة؟",
  "من أخذ عهدة من الصندوق ولم يردها؟",
];
const TOOL_AR: Record<string, string> = {
  search_cases: "بحث الحالات", get_case: "تفاصيل حالة", case_stats: "إحصاءات الحالات", receivables: "المستحقات",
  agent_balances: "حسابات المناديب", cash_summary: "الصناديق", person_accounts: "حسابات الأشخاص", payment_notices: "إشعارات الدفع",
};

/** Tiny safe renderer: **bold**, "- " bullets, line breaks. No HTML injection. */
function Rich({ text }: { text: string }) {
  const inline = (s: string): ReactNode[] => s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>);
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => { if (list.length) { blocks.push(<ul key={`l${blocks.length}`}>{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>); list = []; } };
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (m) { list.push(m[1]); continue; }
    flush();
    if (line.trim()) blocks.push(<p key={`p${blocks.length}`}>{inline(line.replace(/^#+\s*/, ""))}</p>);
  }
  flush();
  return <>{blocks}</>;
}

export function AssistantChat({ configured, remaining , finance = true }: { configured: boolean; remaining: number ; finance?: boolean }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { try { const s = sessionStorage.getItem(KEY); if (s) setMsgs(JSON.parse(s)); } catch { /* ignore */ } }, []);
  useEffect(() => {
    try { sessionStorage.setItem(KEY, JSON.stringify(msgs.slice(-30))); } catch { /* ignore */ }
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs]);

  async function ask(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    const next = [...msgs, { role: "user" as const, content: question }];
    setMsgs(next); setText(""); setBusy(true);
    try {
      const res = await fetch("/admin/assistant-api", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next.filter((m) => !m.error).map(({ role, content }) => ({ role, content })) }),
      });
      const data = (await res.json().catch(() => ({}))) as { reply?: string; tools?: string[]; error?: string };
      setMsgs((m) => [...m, data.reply ? { role: "assistant", content: data.reply, tools: data.tools } : { role: "assistant", content: data.error ?? "حدث خطأ، حاول مرة أخرى.", error: true }]);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", content: "تعذر الاتصال. تحقق من الإنترنت وحاول مرة أخرى.", error: true }]);
    } finally { setBusy(false); }
  }
  const onSubmit = (e: FormEvent) => { e.preventDefault(); void ask(text); };

  if (!configured) {
    return (
      <div className="panel">
        <h2>Setup needed · يلزم الإعداد</h2>
        <p>The assistant uses Claude (Anthropic). Add <code>ANTHROPIC_API_KEY</code> in Vercel → Settings → Environment Variables, then redeploy.</p>
        <p dir="rtl">المساعد يحتاج مفتاح <code>ANTHROPIC_API_KEY</code> من console.anthropic.com يُضاف في إعدادات Vercel ثم إعادة النشر.</p>
      </div>
    );
  }
  return (
    <div className="chat">
      <div className="chat-log" aria-live="polite">
        {msgs.length === 0 ? (
          <div className="chat-empty">
            <div className="chat-hello" dir="rtl">👋 أهلاً! اسألني عن الحالات، الفواتير، المستحقات، الصناديق أو إشعارات الدفع.</div>
            <div className="chat-suggest">{(finance ? SUGGESTIONS : OPS_SUGGESTIONS).map((s) => <button key={s} type="button" dir="rtl" onClick={() => ask(s)}>{s}</button>)}</div>
          </div>
        ) : null}
        {msgs.map((m, i) => (
          <div key={i} className={`bubble ${m.role}${m.error ? " error" : ""}`} dir="auto">
            {m.role === "assistant" && !m.error ? <Rich text={m.content} /> : <p>{m.content}</p>}
            {m.tools?.length ? <div className="bubble-tools">🔎 {[...new Set(m.tools)].map((t) => TOOL_AR[t] ?? t).join(" · ")}</div> : null}
          </div>
        ))}
        {busy ? <div className="bubble assistant thinking" dir="rtl">… يبحث في بيانات النظام</div> : null}
        <div ref={end} />
      </div>
      <form className="chat-input" onSubmit={onSubmit}>
        <textarea value={text} dir="auto" rows={2} maxLength={2000} placeholder={finance ? "اكتب سؤالك… مثلاً: كم دفع المندوب عمر هذا الشهر؟" : "اكتب سؤالك… مثلاً: ما حالات المندوب عمر المفتوحة؟"} aria-label="Question"
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(text); } }} />
        <div className="chat-actions">
          <button className="btn teal" type="submit" disabled={busy || !text.trim()}>إرسال</button>
          {msgs.length ? <button className="btn secondary small" type="button" onClick={() => setMsgs([])} disabled={busy}>محادثة جديدة</button> : null}
          <span className="small muted">{remaining} questions left today</span>
        </div>
      </form>
    </div>
  );
}
