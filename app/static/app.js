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

// Prevent double submission of POST forms (disable the submit button once sent).
function resetSubmitButtons() {
  document.querySelectorAll("form[method=post] button[type=submit]").forEach((b) => {
    b.disabled = false;
    if (b.dataset.label) b.textContent = b.dataset.label;
  });
}
document.querySelectorAll("form[method=post]").forEach((f) => {
  f.addEventListener("submit", (e) => {
    if (e.defaultPrevented) return;
    if (f.dataset.sent) {
      e.preventDefault();
      return;
    }
    f.dataset.sent = "1";
    const b = f.querySelector("button[type=submit]");
    if (!b) return;
    b.dataset.label = b.textContent;
    if (f.dataset.busy) b.textContent = f.dataset.busy;
    // Disable after the submit event so the browser still sends the form.
    setTimeout(() => { b.disabled = true; }, 0);
  });
});
// Back/forward cache restores the page as left: make forms usable again.
window.addEventListener("pageshow", (e) => {
  if (!e.persisted) return;
  document.querySelectorAll("form[data-sent]").forEach((f) => delete f.dataset.sent);
  resetSubmitButtons();
});
