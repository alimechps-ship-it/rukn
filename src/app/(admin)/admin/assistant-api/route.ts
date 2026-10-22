import { NextResponse, type NextRequest } from "next/server";
import { can, getStaffUser } from "@/lib/auth";
import { createSessionClient } from "@/lib/admin";
import { AI_DAILY_LIMIT, callClaude, isAiConfigured, logUsage, textOf, usedToday, type ContentBlock, type Message } from "@/lib/ai";
import { runAssistantTool, toolsFor } from "@/lib/ai-tools";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function system(today: string, name: string, finance: boolean) {
  return `You are the RUKN back-office assistant. RUKN is an Egypt-based dental solutions team (clear aligners, Snap-On, retainers, digital treatment planning) working with agents (مناديب) around the world.
You help ${name}, a RUKN staff member, understand the data of the system: cases, invoices, payments, payment notices, cash boxes and person accounts.

Rules:
- Answer in the language of the question (Arabic by default), short and clear. Use simple lists; bold the key numbers with **…**.
- ALWAYS use the tools to get numbers. Never invent or estimate figures, names or case codes. If a tool returns nothing, say so.
- Amounts: keep the currency with every amount; never add amounts of different currencies together.
- You can only read data. If asked to change, create, confirm or delete something, explain where to do it in the dashboard (e.g. Finance → Payment notices).
- Do not give clinical, diagnostic or treatment advice; that is for the treating doctor and the RUKN clinical team.
- Patients are identified only by their reference; never ask for or guess patient names.
- Today is ${today} (Cairo).${finance ? "" : "\n- This user is a case manager (operations only). They have NO access to prices, invoices, payments or cash. If asked about money, say that the finance manager handles it."}`;
}

export async function POST(req: NextRequest) {
  const user = await getStaffUser();
  if (!user || !can.caseStaff(user)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  if (!isAiConfigured()) return NextResponse.json({ error: "AI is not set up yet: add ANTHROPIC_API_KEY in Vercel → Settings → Environment Variables, then redeploy." }, { status: 503 });
  const db = await createSessionClient();
  if ((await usedToday(db, user.id)) >= AI_DAILY_LIMIT) {
    return NextResponse.json({ error: `Daily limit of ${AI_DAILY_LIMIT} AI questions reached. It resets tomorrow.` }, { status: 429 });
  }
  let body: { messages?: { role: string; content: string }[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request." }, { status: 400 }); }
  const history: Message[] = (body.messages ?? []).slice(-20)
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content.slice(0, 4000) }));
  if (!history.length || history[history.length - 1].role !== "user") return NextResponse.json({ error: "Write a question." }, { status: 400 });

  const { data: me } = await db.from("profiles").select("full_name,email").eq("id", user.id).maybeSingle();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
  const messages: Message[] = [...history];
  const used: string[] = [];
  const finance = can.finance(user);
  const usage = { input_tokens: 0, output_tokens: 0 };
  try {
    for (let round = 0; round < 6; round++) {
      const res = await callClaude({ system: system(today, me?.full_name || me?.email || "a staff member", finance), messages, tools: toolsFor(finance), maxTokens: 1500 });
      usage.input_tokens += res.usage?.input_tokens ?? 0;
      usage.output_tokens += res.usage?.output_tokens ?? 0;
      const calls = res.content.filter((b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use");
      if (res.stop_reason !== "tool_use" || !calls.length) {
        await logUsage(db, user.id, "assistant", usage);
        return NextResponse.json({ reply: textOf(res) || "—", tools: used });
      }
      messages.push({ role: "assistant", content: res.content });
      const results = await Promise.all(calls.map(async (c) => {
        used.push(c.name);
        try {
          const out = await runAssistantTool(db, c.name, c.input ?? {}, finance);
          return { type: "tool_result" as const, tool_use_id: c.id, content: JSON.stringify(out).slice(0, 12000) };
        } catch (e) {
          return { type: "tool_result" as const, tool_use_id: c.id, content: `Error: ${e instanceof Error ? e.message : "failed"}`, is_error: true };
        }
      }));
      messages.push({ role: "user", content: results });
    }
    await logUsage(db, user.id, "assistant", usage);
    return NextResponse.json({ reply: "The question needed too many steps — please make it more specific.", tools: used });
  } catch (e) {
    await logUsage(db, user.id, "assistant", usage);
    return NextResponse.json({ error: e instanceof Error ? e.message : "AI request failed." }, { status: 502 });
  }
}
