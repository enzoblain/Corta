"use client";

export function LogoutButton() {
  async function logout(): Promise<void> {
    await fetch("/api/logout", { method: "POST" });
    window.location.assign("/login");
  }
  return (
    <button type="button" onClick={logout}>
      Se déconnecter
    </button>
  );
}
