// Update-check banner. Runs on every page. Queries /api/version and,
// when a newer version is synced to the user's OneDrive folder, pins a
// banner at the top with an "Install" button that triggers the installer.
(function () {
  async function check() {
    try {
      let v;
      if (window.bonaparte?.getVersion) {
        v = await window.bonaparte.getVersion();
      } else {
        const r = await fetch("/api/version");
        if (!r.ok) return;
        v = await r.json();
      }
      if (!v.hasUpdate) return;
      showBanner(v);
    } catch {}
  }

  function showBanner(v) {
    if (document.getElementById("bonaparte-update-banner")) return;
    try {
      if (sessionStorage.getItem("bonaparte-update-dismissed") === v.latest) return;
    } catch {}

    const bar = document.createElement("div");
    bar.id = "bonaparte-update-banner";
    bar.style.cssText = [
      "position:fixed","top:0","left:0","right:0","z-index:9999",
      "padding:8px 16px","background:var(--accent, #d4a037)","color:var(--bg, #111)",
      "font:500 13px/1.4 var(--font-body, system-ui, sans-serif)",
      "display:flex","justify-content:center","align-items:center","gap:12px",
      "box-shadow:0 2px 6px rgba(0,0,0,.25)",
    ].join(";");

    const msg = document.createElement("span");
    msg.textContent = `Update available: ${v.latest} (you're on ${v.current}).`;
    bar.appendChild(msg);

    const btn = document.createElement("button");
    btn.textContent = v.installerAvailable ? "Install now" : "Installer not synced yet";
    btn.disabled = !v.installerAvailable;
    btn.style.cssText =
      "background:var(--bg, #111);color:var(--accent, #d4a037);border:none;padding:4px 12px;border-radius:4px;font-weight:600;cursor:pointer";
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Launching…";
      try {
        if (window.bonaparte?.runUpdate) {
          await window.bonaparte.runUpdate();
          btn.textContent = "Installer running";
        } else {
          const r = await fetch("/api/run-update", { method: "POST" });
          if (!r.ok) {
            const e = await r.json().catch(() => ({}));
            btn.textContent = e.error || "Failed";
            return;
          }
          btn.textContent = "Installer running";
          setTimeout(() => { try { window.close(); } catch {} }, 600);
        }
      } catch {
        btn.textContent = "Failed";
      }
    });
    bar.appendChild(btn);

    if (v.notes) {
      const notes = document.createElement("span");
      notes.textContent = "— " + v.notes;
      notes.style.cssText = "opacity:.85;font-weight:400";
      bar.appendChild(notes);
    }

    const dismiss = document.createElement("button");
    dismiss.textContent = "×";
    dismiss.title = "Dismiss";
    dismiss.style.cssText =
      "background:transparent;border:none;color:inherit;font-size:18px;line-height:1;cursor:pointer;padding:0 4px";
    dismiss.addEventListener("click", () => {
      bar.remove();
      document.body.style.paddingTop = "";
      try { sessionStorage.setItem("bonaparte-update-dismissed", v.latest); } catch {}
    });
    bar.appendChild(dismiss);

    document.body.appendChild(bar);
    document.body.style.paddingTop = bar.offsetHeight + "px";
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", check);
  } else {
    check();
  }
})();
