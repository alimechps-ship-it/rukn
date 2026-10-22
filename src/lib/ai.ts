import "server-only";
import type { Db } from "./admin";

/**
 * Minimal Claude (Anthropic Messages API) client — no extra dependency.
 * Configure with ANTHROPIC_API_KEY (required) and optionally AI_MODEL / AI_DAILY_LIMIT.
 */
export const AI_MODEL = process.env.AI_MODEL || "claude-sonnet-5-5";
const BASE = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/, "");
export const AI_DAILY_LIMIT = Math.max(1, Number(process.env.AI_DAILY_LIMIT || 150));

export const isAiConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface Message { role: "user" | "assistant"; content: string | ContentBlock[] }
export interface ToolDef { name: string; description: string; input_schema: Record<string, unknown> }
export interface ClaudeResponse {
  content: ContentBlock[]; stop_reason: string; usage?: { input_tokens: number; output_tokens: number };
}

export async function callClaude(opts: {
  system: string; messages: Message[]; tools?: ToolDef[]; toolChoice?: { type: "auto" } | { type: "tool"; name: string };
  maxTokens?: number; model?: string;
}): Promise<ClaudeResponse> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("AI is not configured: add ANTHROPIC_API_KEY in Vercel → Settings → Environment Variables, then redeploy.");
  const res = await fetch(`${BASE}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: opts.model ?? AI_MODEL,
      max_tokens: opts.maxTokens ?? 1500,
      system: opts.system,
      messages: opts.messages,
      ...(opts.tools?.length ? { tools: opts.tools } : {}),
      ...(opts.toolChoice ? { tool_choice: opts.toolChoice } : {}),
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let msg = body;
    try { msg = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? body; } catch { /* keep text */ }
    if (res.status === 401) throw new Error("The AI key is not valid. Check ANTHROPIC_API_KEY in Vercel.");
    if (res.status === 429) throw new Error("The AI service is busy or the account limit was reached. Try again in a minute.");
    throw new Error(`AI request failed (${res.status}): ${msg.slice(0, 300)}`);
  }
  return (await res.json()) as ClaudeResponse;
}

export const textOf = (r: ClaudeResponse) => r.content.filter((b): b is { type: "text"; text: string } => b.type === "text").map((b) => b.text).join("\n").trim();

/** Requests this user made today (Cairo day) — used for the daily limit. */
export async function usedToday(db: Db, userId: string) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const { count } = await db.from("ai_usage").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", start.toISOString());
  return count ?? 0;
}

export async function logUsage(db: Db, userId: string | null, feature: "assistant" | "receipt", usage?: { input_tokens: number; output_tokens: number }) {
  if (!userId) return;
  await db.from("ai_usage").insert({ user_id: userId, feature, model: AI_MODEL, input_tokens: usage?.input_tokens ?? 0, output_tokens: usage?.output_tokens ?? 0 });
}
