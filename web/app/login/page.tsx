import { LoginForm } from "./login-form";

export const metadata = { title: "Connexion – Corta" };

export default function LoginPage() {
  return (
    <main className="card">
      <h1>Connexion</h1>
      <LoginForm />
    </main>
  );
}
