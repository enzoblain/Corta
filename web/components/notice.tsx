import { NOTICES } from "@/lib/capture-shared";

/** Flash message selected by the `?notice=` code; unknown codes render nothing. */
export function Notice({ code }: { code: string | string[] | undefined }) {
  const message = typeof code === "string" ? NOTICES[code] : undefined;
  return message ? <p className="notice" role="status">{message}</p> : null;
}
