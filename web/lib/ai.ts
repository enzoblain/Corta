// Claude Messages API client and strict parsing of its JSON answer.
// Server-side only: never import this from a client component.
import { normalizeTags } from "@/lib/db/queries";

export const API_URL = "https://api.anthropic.com/v1/messages";
export const MODEL = "claude-haiku-5-5";
export const TIMEOUT_MS = 15_000;
export const MAX_TAGS = 3;

/** The AI is unavailable or its answer is unusable (message is safe to show). */
export class AIError extends Error {}

export interface Suggestion {
  title: string;
  content: string;
  projectId: number | null; // existing project, or null
  newProject: string; // name of a proposed new project, "" if none
  tags: string[];
}

export interface ProjectRef {
  id: number;
  name: string;
}

export function buildPrompt(rawText: string, projects: ProjectRef[], tags: string[]): string {
  const projectLines = projects.map((p) => `- ${p.id}: ${p.name}`).join("\n") || "(none)";
  return (
    "You organise ideas for a personal knowledge base. The user wrote a raw idea; " +
    "rewrite it and decide where to file it. Reply in the language of the idea.\n\n" +
    `Existing projects (id: name):\n${projectLines}\n\n` +
    `Existing tags: ${tags.join(", ") || "(none)"}\n\n` +
    "Rules:\n" +
    "- Strongly prefer an existing project. Propose a new project only if none fits.\n" +
    `- Give 1 to ${MAX_TAGS} short tags, reusing existing tags whenever possible.\n` +
    "- title: short and clear. content: the idea rewritten clearly, keeping all details.\n" +
    "Answer with JSON only, no prose, exactly this shape:\n" +
    '{"title": str, "content": str, "project": {"existing_id": int} or {"new_name": str}, ' +
    '"tags": [str]}\n\n' +
    `Raw idea:\n<idea>\n${rawText}\n</idea>`
  );
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/** Validates the model's answer. Throws AIError on anything unexpected. */
export function parseSuggestion(text: string, projectIds: Set<number>, knownTags: string[]): Suggestion {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new AIError("Réponse de l'IA invalide (pas de JSON).");
  let data: unknown;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new AIError("Réponse de l'IA invalide (JSON illisible).");
  }
  if (!isRecord(data)) throw new AIError("Réponse de l'IA invalide.");

  const { title, content, project, tags: rawTags } = data;
  if (!nonEmpty(title)) throw new AIError("Réponse de l'IA invalide (titre manquant).");
  if (!nonEmpty(content)) throw new AIError("Réponse de l'IA invalide (reformulation manquante).");
  if (!isRecord(project)) throw new AIError("Réponse de l'IA invalide (projet manquant).");

  let projectId: number | null = null;
  let newProject = "";
  const existing = project.existing_id;
  const newName = project.new_name;
  if (typeof existing === "number" && Number.isInteger(existing) && projectIds.has(existing)) {
    projectId = existing;
  } else if (nonEmpty(newName)) {
    newProject = newName.trim();
  } else {
    throw new AIError("Réponse de l'IA invalide (projet inconnu).");
  }

  if (!Array.isArray(rawTags) || !rawTags.every((t) => typeof t === "string")) {
    throw new AIError("Réponse de l'IA invalide (tags).");
  }
  const tags = normalizeTags(rawTags as string[], knownTags).slice(0, MAX_TAGS);
  if (tags.length === 0) throw new AIError("Réponse de l'IA invalide (aucun tag).");
  return { title: title.trim(), content: content.trim(), projectId, newProject, tags };
}

/** Asks Claude for a suggestion. Throws AIError for every failure mode. */
export async function suggest(
  apiKey: string,
  rawText: string,
  projects: ProjectRef[],
  tags: string[],
): Promise<Suggestion> {
  if (!apiKey) throw new AIError("Clé API Anthropic absente : l'IA est désactivée.");
  let text: string;
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        messages: [{ role: "user", content: buildPrompt(rawText, projects, tags) }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      // Never log headers/key; the status is enough.
      console.warn(`Claude API call failed: HTTP ${res.status}`);
      throw new AIError("L'appel à l'IA a échoué.");
    }
    const body: unknown = await res.json();
    const blocks = isRecord(body) && Array.isArray(body.content) ? (body.content as unknown[]) : null;
    if (!blocks) throw new AIError("Réponse de l'IA illisible.");
    text = blocks
      .map((b) => (isRecord(b) && b.type === "text" && typeof b.text === "string" ? b.text : ""))
      .join("");
  } catch (e) {
    if (e instanceof AIError) throw e;
    if (e instanceof Error && e.name === "TimeoutError") {
      throw new AIError("L'IA n'a pas répondu à temps.");
    }
    if (e instanceof SyntaxError) throw new AIError("Réponse de l'IA illisible.");
    console.warn(`Claude API call failed: ${e instanceof Error ? e.message : "unknown error"}`);
    throw new AIError("L'appel à l'IA a échoué.");
  }
  return parseSuggestion(text, new Set(projects.map((p) => p.id)), tags);
}
