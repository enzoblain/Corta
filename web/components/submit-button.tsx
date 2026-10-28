"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

/** Disabled with « En cours… » while the parent form is submitting (no double submit). */
export function SubmitButton({ children, danger }: { children: ReactNode; danger?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={danger ? "danger" : undefined}>
      {pending ? "En cours…" : children}
    </button>
  );
}
