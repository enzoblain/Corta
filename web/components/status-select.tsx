"use client";

import { useState, useTransition } from "react";
import { setStatusAction } from "@/app/actions";
import { STATUSES, STATUS_LABELS } from "@/lib/db/queries";
import type { IdeaStatus } from "@/lib/types";

/** Changes the status without reloading; reverts and shows the error if the save fails. */
export function StatusSelect({ id, status }: { id: number; status: IdeaStatus }) {
  const [value, setValue] = useState(status);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  function onChange(next: IdeaStatus): void {
    const previous = value;
    setValue(next);
    setError("");
    start(async () => {
      const res = await setStatusAction(id, next);
      if (res.error) {
        setValue(previous);
        setError(res.error);
      }
    });
  }

  return (
    <span className="status-wrap">
      <select
        className="status"
        aria-label="Statut"
        value={value}
        disabled={pending}
        onChange={(e) => onChange(e.target.value as IdeaStatus)}
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>{STATUS_LABELS[s]}</option>
        ))}
      </select>
      {pending ? <small> En cours…</small> : null}
      {error ? <small className="error" role="alert"> {error}</small> : null}
    </span>
  );
}
