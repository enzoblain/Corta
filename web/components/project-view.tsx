import Link from "next/link";
import { getDb } from "@/lib/db";
import * as q from "@/lib/db/queries";
import type { IdeaStatus } from "@/lib/types";
import { Notice } from "./notice";
import { IdeaList } from "./idea-list";
import { ManageProject } from "./project-forms";
import { Nav } from "./nav";

type Params = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** Shared by /inbox (projectId null) and /project/[id]. */
export function ProjectView({ projectId, searchParams }: { projectId: number | null; searchParams: Params }) {
  const db = getDb();
  const project = projectId === null ? undefined : q.getProject(db, projectId);
  const rawStatus = first(searchParams.status);
  const status: IdeaStatus | "" = q.isStatus(rawStatus) ? rawStatus : "";
  const tag = first(searchParams.tag);
  const ideas = q.listIdeas(db, projectId, status || null, tag || null);
  const tags = q.tagsOfIdeas(db, ideas.map((i) => i.id));
  const allTags = q.projectTags(db, projectId);
  const base = projectId === null ? "/inbox" : `/project/${projectId}`;

  function filterLink(label: string, st: string, tg: string) {
    const qs = new URLSearchParams();
    if (st) qs.set("status", st);
    if (tg) qs.set("tag", tg);
    const href = qs.size ? `${base}?${qs}` : base;
    return (
      <Link key={label} href={href} className={st === status && tg === tag ? "on" : undefined}>
        {label}
      </Link>
    );
  }

  return (
    <>
      <Nav />
      <main className="wrap">
        <h1>{project ? project.name : "Inbox"}</h1>
        <Notice code={searchParams.notice} />
        <p><Link href="/">← Projets</Link></p>
        {project ? <ManageProject project={project} /> : null}
        <nav className="filters">
          {filterLink("Tous", "", tag)}
          {q.STATUSES.map((s) => filterLink(q.STATUS_LABELS[s], s, tag))}
        </nav>
        <nav className="filters">
          {tag ? filterLink("Tous les tags", status, "") : null}
          {allTags.map((t) => filterLink("#" + t, status, t))}
        </nav>
        <IdeaList ideas={ideas} tags={tags} />
      </main>
    </>
  );
}
