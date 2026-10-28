import Link from "next/link";
import type { Idea } from "@/lib/types";
import { ReprocessButton } from "./project-forms";
import { StatusSelect } from "./status-select";

export function IdeaList({ ideas, tags }: { ideas: Idea[]; tags: Map<number, string[]> }) {
  if (ideas.length === 0) return <p>Aucune idée.</p>;
  return (
    <ul className="list">
      {ideas.map((idea) => (
        <li key={idea.id} className={`idea s-${idea.status}`}>
          <Link className="title" href={`/idea/${idea.id}`}>
            {idea.title || idea.raw_text.slice(0, 80)}
          </Link>
          <p className="tags">
            {(tags.get(idea.id) ?? []).map((t) => (
              <span key={t} className="tag">{t}</span>
            ))}
          </p>
          <StatusSelect id={idea.id} status={idea.status} />
          {idea.project_id === null ? <ReprocessButton ideaId={idea.id} /> : null}
        </li>
      ))}
    </ul>
  );
}
