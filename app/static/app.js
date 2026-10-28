// Confirm before destructive forms.
document.querySelectorAll("form[data-confirm]").forEach((f) => {
  f.addEventListener("submit", (e) => {
    if (!confirm(f.dataset.confirm)) e.preventDefault();
  });
});

// Change an idea's status in one click, without reloading.
document.querySelectorAll("select.status").forEach((sel) => {
  sel.addEventListener("change", async () => {
    const body = new URLSearchParams({ id: sel.dataset.id, status: sel.value });
    sel.disabled = true;
    try {
      const r = await fetch("/api/idea/status", { method: "POST", body });
      if (!r.ok) throw new Error(r.status);
      sel.dataset.current = sel.value;
      sel.closest("li").className = "idea s-" + sel.value;
    } catch (_) {
      sel.value = sel.dataset.current;
      alert("Échec du changement de statut.");
    }
    sel.disabled = false;
  });
});
