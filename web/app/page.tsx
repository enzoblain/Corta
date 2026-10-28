import { LogoutButton } from "./logout-button";

export default function Home() {
  return (
    <main className="card">
      <h1>Corta</h1>
      <p>Socle Next.js en place. Les projets et les idées arrivent dans N2 et N3.</p>
      <LogoutButton />
    </main>
  );
}
