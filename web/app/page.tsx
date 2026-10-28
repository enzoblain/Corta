import Link from "next/link";
import { CreateProjectForm } from "@/components/project-forms";
import { Nav } from "@/components/nav";
import { getDb } from "@/lib/db";
import * as q from "@/lib/db/queries";

export const dynamic = "force-dynamic";

function Counts({ c }: { c: q.StatusCounts }) {
  return <p className="counts">{q.STATUSES.map((s) => `${q.STATUS_LABELS[s]} : ${c[s]}`).join(" · ")}</p>;
}

export default function Home() {
  const db = getDb();
  const projects = q.projectCounts(db);
  return (
    <>
      <Nav />
      <main className="wrap">
        <h1>Projets</h1>
        <ul className="list">
          <li>
            <Link className="title" href="/inbox">Inbox</Link>
            <Counts c={q.inboxCounts(db)} />
          </li>
          {projects.map((p) => (
            <li key={p.id}>
              <Link className="title" href={`/project/${p.id}`}>{p.name}</Link>
              <Counts c={p} />
            </li>
          ))}
        </ul>
        <CreateProjectForm />
      </main>
    </>
  );
}
