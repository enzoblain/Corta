"use client";

import { useState, type FormEvent } from "react";
import { NAME_MAX, type CaptureResult, type SuggestionView } from "@/lib/capture-shared";

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function navigateTo(path: string): void {
  window.location.assign(path);
}

/** Runs a capture/reprocess request and routes to the Inbox or hands back the suggestion. */
async function runCapture(url: string, body: unknown): Promise<SuggestionView | null> {
  const res = await postJson(url, body);
  if (!res.ok) throw new Error("Erreur serveur.");
  const result = (await res.json()) as CaptureResult;
  if (result.kind === "suggestion") return result.view;
  navigateTo(result.kind === "inbox" ? `/inbox?notice=${result.notice}` : "/");
  return null;
}

export function CaptureForm({ onSuggestion }: { onSuggestion: (view: SuggestionView) => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const raw = String(new FormData(e.currentTarget).get("raw_text") ?? "");
    try {
      const view = await runCapture("/api/capture/suggest", { raw_text: raw });
      if (view) onSuggestion(view);
      else return; // navigating away
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    }
    setBusy(false);
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: "0.5rem" }}>
      <label>
        Nouvelle idée
        <textarea name="raw_text" rows={4} maxLength={2000} required autoFocus />
      </label>
      <button type="submit" disabled={busy}>
        {busy ? "L'IA réfléchit…" : "Capturer"}
      </button>
      <p className="error" role="alert">
        {error}
      </p>
    </form>
  );
}

export function SuggestionForm({ view, onCancel }: { view: SuggestionView; onCancel: () => void }) {
  const { suggestion } = view;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState(suggestion.newProject ? "new" : suggestion.projectId === null ? "" : String(suggestion.projectId));

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const formData = new FormData(e.currentTarget);
    try {
      const res = await postJson("/api/capture/confirm", {
        raw_text: view.rawText,
        idea_id: view.ideaId,
        title: String(formData.get("title") ?? ""),
        content: String(formData.get("content") ?? ""),
        tags: String(formData.get("tags") ?? ""),
        project_id: choice,
        new_project: String(formData.get("new_project") ?? ""),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; inbox?: boolean };
      if (res.ok && data.ok) {
        navigateTo(data.inbox ? "/inbox?notice=saved" : "/?notice=saved");
        return;
      }
      setError(data.error ?? "Erreur serveur.");
    } catch {
      setError("Serveur injoignable.");
    }
    setBusy(false);
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: "0.75rem" }}>
      <h2>Valider la suggestion</h2>
      <label>
        Titre
        <input name="title" defaultValue={suggestion.title} required />
      </label>
      <label>
        Reformulation
        <textarea name="content" rows={6} defaultValue={suggestion.content} required />
      </label>
      <label>
        Projet
        <select value={choice} onChange={(e) => setChoice(e.target.value)}>
          <option value="">Inbox (aucun projet)</option>
          {suggestion.newProject && <option value="new">➕ Nouveau : {suggestion.newProject}</option>}
          {view.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Nom du nouveau projet (utilisé seulement si « Nouveau » est choisi)
        <input name="new_project" defaultValue={suggestion.newProject} maxLength={NAME_MAX} />
      </label>
      <label>
        Tags (séparés par des virgules, 1 à 3)
        <input name="tags" defaultValue={suggestion.tags.join(", ")} required />
      </label>
      <p className="error" role="alert">
        {error}
      </p>
      <div>
        <button type="submit" disabled={busy}>
          Valider
        </button>{" "}
        <button type="button" onClick={onCancel} disabled={busy}>
          Annuler
        </button>
      </div>
    </form>
  );
}

export function Capture() {
  const [view, setView] = useState<SuggestionView | null>(null);
  return view ? (
    <SuggestionForm view={view} onCancel={() => setView(null)} />
  ) : (
    <CaptureForm onSuggestion={setView} />
  );
}

export function ReprocessButton({ ideaId }: { ideaId: number }) {
  const [view, setView] = useState<SuggestionView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onClick(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const nextView = await runCapture("/api/capture/reprocess", { idea_id: ideaId });
      if (nextView) setView(nextView);
      else return;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur.");
    }
    setBusy(false);
  }

  if (view) return <SuggestionForm view={view} onCancel={() => setView(null)} />;
  return (
    <>
      <button type="button" onClick={onClick} disabled={busy}>
        {busy ? "L'IA réfléchit…" : "Retraiter avec l'IA"}
      </button>
      {error && <span className="error">{error}</span>}
    </>
  );
}
