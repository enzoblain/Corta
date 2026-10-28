import { IdeaList } from "@/components/idea-list";
import { Nav } from "@/components/nav";
import { getDb } from "@/lib/db";
import * as q from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const raw = (await searchParams).q;
  const term = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  const db = getDb();
  const ideas = term ? q.searchIdeas(db, term) : [];
  const tags = q.tagsOfIdeas(db, ideas.map((i) => i.id));
  return (
    <>
      <Nav q={term} />
      <main className="wrap">
        <h1>Recherche</h1>
        <p>{term ? `${ideas.length} résultat(s) pour « ${term} »` : "Saisissez un terme."}</p>
        <IdeaList ideas={ideas} tags={tags} />
      </main>
    </>
  );
}
