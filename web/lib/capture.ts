// Capture flow: raw idea -> AI suggestion -> user validation. Framework-free so it is easy to test.
import type { ProjectRef } from "@/lib/ai";
import { AIError, MAX_TAGS, suggest as aiSuggest } from "@/lib/ai";
import type { Db } from "@/lib/db";
import * as queries from "@/lib/db/queries";

import { MAX_IDEA, NAME_MAX, type CaptureResult } from "@/lib/capture-shared";

const refs = (db: Db): ProjectRef[] => queries.listProjects(db).map(({ id, name }) => ({ id, name }));

export type Suggester = typeof aiSuggest;

/** Raw idea -> suggestion to validate. Nothing is stored unless the AI fails (plan B: Inbox). */
export async function captureSuggest(
  db: Db,
  apiKey: string,
  rawInput: string,
  suggest: Suggester = aiSuggest,
): Promise<CaptureResult> {
  const raw = rawInput.trim().slice(0, MAX_IDEA);
  if (!raw) return { kind: "ignored" };
  const projects = refs(db);
  try {
    const suggestion = await suggest(apiKey, raw, projects, queries.listTagNames(db));
    return { kind: "suggestion", view: { rawText: raw, ideaId: null, suggestion, projects } };
  } catch (e) {
    if (!(e instanceof AIError)) throw e;
    console.warn(`AI suggestion failed: ${e.message}`);
    queries.createIdea(db, raw);
    return { kind: "inbox", notice: apiKey ? "ai_error" : "no_key" };
  }
}

/** Re-runs the AI on an Inbox idea. Stores nothing. */
export async function captureReprocess(
  db: Db,
  apiKey: string,
  ideaId: number,
  suggest: Suggester = aiSuggest,
): Promise<CaptureResult> {
  const idea = queries.getIdea(db, ideaId);
  if (!idea || idea.project_id !== null) return { kind: "ignored" };
  const projects = refs(db);
  try {
    const suggestion = await suggest(apiKey, idea.raw_text, projects, queries.listTagNames(db));
    return { kind: "suggestion", view: { rawText: idea.raw_text, ideaId: idea.id, suggestion, projects } };
  } catch (e) {
    if (!(e instanceof AIError)) throw e;
    console.warn(`AI reprocess failed: ${e.message}`);
    return { kind: "inbox", notice: apiKey ? "reprocess_error" : "no_key" };
  }
}

export interface ConfirmInput {
  rawText: string;
  ideaId: number | null;
  title: string;
  content: string;
  tags: string; // comma separated
  projectChoice: string; // "" = Inbox, "new", or a project id
  newProject: string;
}

export type ConfirmResult = { ok: true; inbox: boolean } | { ok: false; error: string };

/** Stores the validated idea in one transaction. */
export function captureConfirm(db: Db, input: ConfirmInput): ConfirmResult {
  const title = input.title.trim();
  const content = input.content.trim();
  const typed = queries.normalizeTags(input.tags.split(","), []).slice(0, MAX_TAGS);
  if (!title || !content || typed.length === 0) {
    return { ok: false, error: "Titre, reformulation et au moins un tag sont requis." };
  }
  const run = db.transaction((): ConfirmResult => {
    const tags = queries.normalizeTags(typed, queries.listTagNames(db));
    let projectId: number | null = null;
    if (input.projectChoice === "new") {
      const name = input.newProject.trim().slice(0, NAME_MAX);
      if (!name) return { ok: false, error: "Nom du nouveau projet requis." };
      projectId = queries.getOrCreateProject(db, name);
    } else if (/^\d+$/.test(input.projectChoice)) {
      const id = Number(input.projectChoice);
      if (!refs(db).some((p) => p.id === id)) return { ok: false, error: "Projet inconnu." };
      projectId = id;
    }
    let ideaId: number;
    if (input.ideaId === null) {
      ideaId = queries.createIdea(db, input.rawText.trim() || content);
    } else {
      const idea = queries.getIdea(db, input.ideaId);
      // Same guard as reprocess: only an idea still in the Inbox can be rewritten.
      if (!idea || idea.project_id !== null) return { ok: false, error: "Idée introuvable dans l'Inbox." };
      ideaId = idea.id;
    }
    queries.applySuggestion(db, ideaId, { title, content, projectId });
    queries.setIdeaTags(db, ideaId, tags);
    return { ok: true, inbox: projectId === null };
  });
  return run();
}
