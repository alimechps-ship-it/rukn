import { AssistantChat } from "@/components/admin/AssistantChat";
import { can, requireStaff } from "@/lib/auth";
import { createSessionClient } from "@/lib/admin";
import { AI_DAILY_LIMIT, isAiConfigured, usedToday } from "@/lib/ai";

export const metadata = { title: "AI assistant" };

export default async function AssistantPage() {
  const user = await requireStaff(can.caseStaff);
  const db = await createSessionClient();
  const used = isAiConfigured() ? await usedToday(db, user.id) : 0;
  return (
    <>
      <div className="topbar">
        <div>
          <h1>AI assistant · المساعد الذكي</h1>
          <div className="sub">Ask in Arabic or English about cases, invoices, receivables, cash boxes and payment notices. It only reads data you are allowed to see, and never changes anything.</div>
        </div>
      </div>
      <AssistantChat configured={isAiConfigured()} remaining={Math.max(0, AI_DAILY_LIMIT - used)} />
    </>
  );
}
