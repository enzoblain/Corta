"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/require";
import { getDb } from "@/lib/db";
import { NAME_MAX } from "@/lib/capture-shared";
import { projectHref } from "@/lib/links";
import * as q from "@/lib/db/queries";

export interface FormState {
  error: string;
}

function parseId(raw: FormDataEntryValue | null): number | null {
  const s = typeof raw === "string" ? raw : "";
  return /^\d+$/.test(s) ? Number(s) : null;
}

function text(data: FormData, key: string): string {
  const v = data.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function isUniqueError(e: unknown): boolean {
  return e instanceof Error && "code" in e && String(e.code).startsWith("SQLITE_CONSTRAINT");
}

export async function createProjectAction(_prev: FormState, data: FormData): Promise<FormState> {
  await requireSession();
  const name = text(data, "name").slice(0, NAME_MAX);
  if (!name) return { error: "Nom requis." };
  let id: number;
  try {
    id = q.createProject(getDb(), name);
  } catch (e) {
    if (isUniqueError(e)) return { error: "Ce projet existe déjà." };
    throw e;
  }
  redirect(projectHref(id));
}

export async function renameProjectAction(_prev: FormState, data: FormData): Promise<FormState> {
  await requireSession();
  const id = parseId(data.get("id"));
  const name = text(data, "name").slice(0, NAME_MAX);
  if (id === null || !name) return { error: "Nom requis." };
  try {
    q.renameProject(getDb(), id, name);
  } catch (e) {
    if (isUniqueError(e)) return { error: "Ce nom est déjà pris." };
    throw e;
  }
  revalidatePath("/", "layout");
  return { error: "" };
}

export async function deleteProjectAction(data: FormData): Promise<void> {
  await requireSession();
  const id = parseId(data.get("id"));
  if (id !== null) q.deleteProject(getDb(), id);
  redirect("/");
}

export async function saveIdeaAction(_prev: FormState, data: FormData): Promise<FormState> {
  await requireSession();
  const id = parseId(data.get("id"));
  const status = text(data, "status");
  const projectRaw = text(data, "project_id");
  const projectId = parseId(projectRaw);
  if (id === null || !q.isStatus(status) || (projectRaw && projectId === null)) {
    return { error: "Requête invalide." };
  }
  const db = getDb();
  if (!q.getIdea(db, id)) return { error: "Idée introuvable." };
  if (projectId !== null && !q.getProject(db, projectId)) return { error: "Projet introuvable." };
  const tags = q.normalizeTags(text(data, "tags").split(","), q.listTagNames(db));
  db.transaction(() => {
    q.updateIdea(db, id, {
      title: text(data, "title") || null,
      content: text(data, "content") || null,
      projectId,
      status,
    });
    q.setIdeaTags(db, id, tags);
  })();
  redirect(projectHref(projectId));
}

/** Called from the status select without reloading the page. */
export async function setStatusAction(id: number, status: string): Promise<FormState> {
  await requireSession();
  if (!Number.isInteger(id) || !q.isStatus(status)) return { error: "Statut invalide." };
  if (!q.setIdeaStatus(getDb(), id, status)) return { error: "Idée introuvable." };
  return { error: "" };
}
