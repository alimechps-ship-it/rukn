"use client";

import { useActionState, useEffect, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import type { ActionResult } from "./ActionForm";

function Btn({ children, title }: { children: ReactNode; title?: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" className="btn secondary small" disabled={pending} title={title} aria-label={title}>{pending ? "…" : children}</button>;
}

/** One-click action (e.g. reorder) that reports server errors honestly. */
export function InstantAction({ action, hidden, children, title }: { action: (p: ActionResult, fd: FormData) => Promise<ActionResult>; hidden: Record<string, string>; children: ReactNode; title?: string }) {
  const [state, formAction] = useActionState(action, null);
  const router = useRouter();
  useEffect(() => { if (state?.ok) router.refresh(); }, [state, router]);
  return (
    <form action={formAction} className="inline">
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <Btn title={title}>{children}</Btn>
      {state && !state.ok ? <span className="small" role="alert" style={{ color: "var(--danger)" }}> {state.message}</span> : null}
    </form>
  );
}
