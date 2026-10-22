// Local stand-in for the Anthropic Messages API (tests only).
// - Receipt reading: decodes the attached PNG/PDF and looks for "AMOUNT=…", "CUR=…", "REF=…", "DATE=…" markers.
// - Assistant: first turn calls a tool chosen from keywords; after the tool result it answers with a summary of it.
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT || 54400);
const log = [];

function reply(res, obj, status = 200) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}

http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/__log") return reply(res, log.slice(-50));
  // Stand-in for the exchange-rates service (FX_API_URL=http://localhost:54400/fx).
  if (req.method === "GET" && req.url === "/fx") return reply(res, { result: "success", time_last_update_utc: new Date().toUTCString(),
    rates: { USD: 1, EGP: 50.25, EUR: 0.9, SAR: 3.75, AED: 3.6725, JOD: 0.709, KWD: 0.307, GBP: 0.78, QAR: 3.64 } });
  if (req.method !== "POST" || req.url !== "/v1/messages") return reply(res, { error: { message: "not found" } }, 404);
  if (!req.headers["x-api-key"]) return reply(res, { error: { message: "missing key" } }, 401);
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = JSON.parse(raw);
    const tools = (body.tools || []).map((t) => t.name);
    const last = body.messages[body.messages.length - 1];
    log.push({ model: body.model, tools, lastRole: last.role, at: new Date().toISOString() });
    const usage = { input_tokens: 120, output_tokens: 40 };

    if (tools.includes("record_receipt")) {
      const att = last.content.find((b) => b.type === "image" || b.type === "document");
      const text = att ? Buffer.from(att.source.data, "base64").toString("latin1") : "";
      const m = (k) => (text.match(new RegExp(`${k}=([A-Za-z0-9.\\-]+)`)) || [])[1] || null;
      const amount = m("AMOUNT");
      const input = amount
        ? { readable: true, amount: Number(amount), currency: m("CUR") || "USD", date: m("DATE"), reference: m("REF"), sender: "Test Sender", receiver: "RUKN", bank_or_service: "Test Bank", notes: null }
        : { readable: false, amount: null, currency: null, date: null, reference: null };
      return reply(res, { id: "msg_mock", type: "message", role: "assistant", model: body.model, stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "toolu_r1", name: "record_receipt", input }], usage });
    }

    const lastBlocks = Array.isArray(last.content) ? last.content : [];
    const toolResult = lastBlocks.find((b) => b.type === "tool_result");
    if (toolResult) {
      return reply(res, { id: "msg_mock", type: "message", role: "assistant", model: body.model, stop_reason: "end_turn",
        content: [{ type: "text", text: `**نتيجة من النظام:**\n- ${String(toolResult.content).slice(0, 600)}` }], usage });
    }
    const q = typeof last.content === "string" ? last.content : "";
    const wanted = /صندوق|cash/i.test(q) ? "cash_summary" : /إشعار|notice/i.test(q) ? "payment_notices" : /متأخر|مستحق|receivable/i.test(q) ? "receivables" : /حال|case/i.test(q) ? "case_stats" : "agent_balances";
    const tool = tools.includes(wanted) ? wanted : "case_stats"; // a case manager only gets the case tools
    return reply(res, { id: "msg_mock", type: "message", role: "assistant", model: body.model, stop_reason: "tool_use",
      content: [{ type: "text", text: "سأبحث في البيانات." }, { type: "tool_use", id: "toolu_a1", name: tool, input: tool === "payment_notices" ? { status: "all" } : {} }], usage });
  });
}).listen(PORT, () => console.log(`mock anthropic on ${PORT}`));
