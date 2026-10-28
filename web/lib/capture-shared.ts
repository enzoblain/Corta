// Types and labels shared by the server and the client components (no server imports here).
import type { ProjectRef, Suggestion } from "@/lib/ai";

export const MAX_IDEA = 2000;
export const NAME_MAX = 100; // project name, same limit as the project forms

export interface SuggestionView {
  rawText: string;
  ideaId: number | null; // set when reprocessing an Inbox idea
  suggestion: Suggestion;
  projects: ProjectRef[];
}

export type CaptureResult =
  | { kind: "suggestion"; view: SuggestionView }
  | { kind: "inbox"; notice: "no_key" | "ai_error" | "reprocess_error" }
  | { kind: "ignored" };

export const NOTICES: Record<string, string> = {
  saved: "Idée enregistrée.",
  no_key: "Clé API absente : l'idée brute est dans l'Inbox, sans traitement IA.",
  ai_error: "L'IA a échoué : l'idée brute est dans l'Inbox. Vous pouvez la retraiter plus tard.",
  reprocess_error: "L'IA a échoué : l'idée reste dans l'Inbox.",
};

