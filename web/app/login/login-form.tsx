"use client";

import { useState, type FormEvent } from "react";

export function LoginForm() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const password = String(new FormData(e.currentTarget).get("password") ?? "");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        window.location.assign("/");
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Erreur de connexion.");
    } catch {
      setError("Serveur injoignable.");
    }
    setBusy(false);
  }

  return (
    <form onSubmit={onSubmit} className="card" style={{ margin: 0 }}>
      <p className="error" role="alert">
        {error}
      </p>
      <label>
        Mot de passe
        <input type="password" name="password" autoFocus required />
      </label>
      <button type="submit" disabled={busy}>
        {busy ? "En cours…" : "Se connecter"}
      </button>
    </form>
  );
}
