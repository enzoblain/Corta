import Link from "next/link";
import { LogoutButton } from "@/app/logout-button";

export function Nav({ q = "" }: { q?: string }) {
  return (
    <header className="nav">
      <Link href="/">Projets</Link>
      <Link href="/inbox">Inbox</Link>
      <form action="/search" className="inline">
        <input type="search" name="q" defaultValue={q} placeholder="Rechercher" aria-label="Recherche" />
        <button type="submit">OK</button>
      </form>
      <LogoutButton />
    </header>
  );
}
