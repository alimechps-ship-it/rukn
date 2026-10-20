"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import type { ActionResult } from "./ActionForm";

function Confirm({ label, danger }: { label: string; danger: boolean }) {
  const { pending } = useFormStatus();
  return <button type="submit" className={`btn ${danger ? "danger solid" : "teal"}`} disabled={pending}>{pending ? "Working…" : label}</button>;
}

/**
 * Button that opens a confirmation dialog before running a server action.
 * Used for destructive or publishing operations.
 */
export function ConfirmAction({
  action, label, title, message, confirmLabel = "Confirm", danger = false, small = true, hidden,
}: {
  action: (prev: ActionResult, fd: FormData) => Promise<ActionResult>;
  label: ReactNode; title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; small?: boolean;
  hidden?: Record<string, string>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, formAction] = useActionState(action, null);
  const router = useRouter();
  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      ref.current?.close();
      if (state.redirectTo) router.push(state.redirectTo);
      else router.refresh();
    }
  }, [state, router]);
  return (
    <>
      <button type="button" className={`btn ${danger ? "danger" : "secondary"} ${small ? "small" : ""}`} onClick={() => ref.current?.showModal()}>{label}</button>
      {state && state.ok ? <span className="small" role="status" style={{ color: "var(--ok)", marginInlineStart: 6 }}>{state.message}</span> : null}
      <dialog ref={ref} className="confirm" aria-labelledby={undefined}>
        <form action={formAction}>
          {hidden ? Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />) : null}
          <div className="dlg-head"><strong>{title}</strong></div>
          <div className="dlg-body">
            {state && !state.ok ? <div className="flash err" role="alert">{state.message}</div> : null}
            <div>{message}</div>
          </div>
          <div className="dlg-foot">
            <button type="button" className="btn secondary" onClick={() => ref.current?.close()}>Cancel</button>
            <Confirm label={confirmLabel} danger={danger} />
          </div>
        </form>
      </dialog>
    </>
  );
}
