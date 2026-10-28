"use client";

import { useActionState } from "react";
import {
  createProjectAction,
  deleteProjectAction,
  reprocessIdeaAction,
  renameProjectAction,
  saveIdeaAction,
  type FormState,
} from "@/app/actions";
import { STATUSES, STATUS_LABELS } from "@/lib/db/queries";
import type { Idea, Project } from "@/lib/types";
import { SubmitButton } from "./submit-button";

const initial: FormState = { error: "" };

export function CreateProjectForm() {
  const [state, action] = useActionState(createProjectAction, initial);
  return (
    <form className="inline" action={action}>
      <input name="name" placeholder="Nouveau projet" required maxLength={100} aria-label="Nom du projet" />
      <SubmitButton>Créer</SubmitButton>
      <p className="error" role="alert">{state.error}</p>
    </form>
  );
}

export function ManageProject({ project }: { project: Project }) {
  const [state, action] = useActionState(renameProjectAction, initial);
  return (
    <div className="manage">
      <form className="inline" action={action}>
        <input type="hidden" name="id" value={project.id} />
        <input name="name" defaultValue={project.name} key={project.name} required maxLength={100} aria-label="Nouveau nom" />
        <SubmitButton>Renommer</SubmitButton>
      </form>
      <form
        action={deleteProjectAction}
        onSubmit={(e) => {
          if (!confirm("Supprimer ce projet ? Ses idées retourneront dans l'Inbox.")) e.preventDefault();
        }}
      >
        <input type="hidden" name="id" value={project.id} />
        <SubmitButton danger>Supprimer</SubmitButton>
      </form>
      <p className="error" role="alert">{state.error}</p>
    </div>
  );
}

export function ReprocessButton({ ideaId }: { ideaId: number }) {
  const [state, action] = useActionState(reprocessIdeaAction, initial);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={ideaId} />
      <SubmitButton>Retraiter avec l'IA</SubmitButton>
      <p className="error" role="alert">{state.error}</p>
    </form>
  );
}

export function IdeaForm({ idea, projects, tags }: { idea: Idea; projects: Project[]; tags: string[] }) {
  const [state, action] = useActionState(saveIdeaAction, initial);
  return (
    <form action={action} className="stack">
      <input type="hidden" name="id" value={idea.id} />
      <label>Titre <input name="title" defaultValue={idea.title ?? ""} /></label>
      <label>Contenu <textarea name="content" rows={8} defaultValue={idea.content ?? ""} /></label>
      <label>
        Projet
        <select name="project_id" defaultValue={idea.project_id ?? ""}>
          <option value="">Inbox</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>
      <label>
        Statut
        <select name="status" defaultValue={idea.status}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
      </label>
      <label>Tags (séparés par des virgules) <input name="tags" defaultValue={tags.join(", ")} /></label>
      <SubmitButton>Enregistrer</SubmitButton>
      <p className="error" role="alert">{state.error}</p>
    </form>
  );
}
