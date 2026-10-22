"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, type FormEvent, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

export type ActionResult = { ok: boolean; message: string; redirectTo?: string } | null;
type Action = (prev: ActionResult, fd: FormData) => Promise<ActionResult>;

const PendingCtx = createContext<boolean | null>(null);

export function SubmitButton({ children, className = "btn", pendingText = "Saving…", name, value, disabled }: { children: ReactNode; className?: string; pendingText?: string; name?: string; value?: string; disabled?: boolean }) {
  const ctx = useContext(PendingCtx);
  const status = useFormStatus();
  const pending = ctx ?? status.pending;
  return (
    <button type="submit" className={className} disabled={pending || disabled} aria-busy={pending} name={name} value={value}>
      {pending ? pendingText : children}
    </button>
  );
}

export function Flash({ result }: { result: ActionResult }) {
  if (!result) return null;
  return <div className={`flash ${result.ok ? "ok" : "err"}`} role={result.ok ? "status" : "alert"}>{result.message}</div>;
}

/**
 * Form bound to a server action. Shows the real success / error message returned
 * by the server, keeps what the user typed (no automatic reset), and refreshes
 * server data after a successful save.
 */
export function ActionForm({ action, children, className, resetOnSuccess = false, id, onSuccess }: { action: Action; children: ReactNode; className?: string; resetOnSuccess?: boolean; id?: string; onSuccess?: () => void }) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (!state?.ok) return;
    if (resetOnSuccess) ref.current?.reset();
    onSuccess?.();
    if (state.redirectTo) router.push(state.redirectTo);
    else router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, resetOnSuccess, router]);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const fd = new FormData(e.currentTarget, submitter ?? undefined);
    startTransition(() => formAction(fd));
  };

  return (
    <PendingCtx.Provider value={pending}>
      <form ref={ref} onSubmit={onSubmit} className={className} id={id} noValidate={false}>
        <Flash result={state} />
        {children}
      </form>
    </PendingCtx.Provider>
  );
}
