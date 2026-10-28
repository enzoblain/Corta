import Link from "next/link";
import { notFound } from "next/navigation";
import { IdeaForm } from "@/components/project-forms";
import { Nav } from "@/components/nav";
import { getDb } from "@/lib/db";
import * as q from "@/lib/db/queries";
import { projectHref } from "@/lib/links";

export const dynamic = "force-dynamic";

export default async function IdeaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const idea = /^\d+$/.test(id) ? q.getIdea(db, Number(id)) : undefined;
  if (!idea) notFound();
  const tags = q.tagsOfIdeas(db, [idea.id]).get(idea.id) ?? [];
  return (
    <>
      <Nav />
      <main className="wrap">
        <p><Link href={projectHref(idea.project_id)}>← Retour</Link></p>
        <h1>Modifier l'idée</h1>
        <IdeaForm idea={idea} projects={q.listProjects(db)} tags={tags} />
        <details>
          <summary>Texte brut d'origine</summary>
          <pre className="raw">{idea.raw_text}</pre>
        </details>
      </main>
    </>
  );
}
