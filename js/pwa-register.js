// Registers the offline service worker (see sw.js) and shows a small offline
// indicator banner. Registration is guarded so it no-ops where service
// workers aren't supported or there's no secure context (e.g. file://),
// leaving the app fully functional without offline support. Shared by every
// page so the registration/update flow lives in one place.
if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  });
}

// ── Offline indicator ────────────────────────────────────────────────────────
// A fixed pill banner while the connection is down, plus a short "back
// online" notice. Styles are inline and self-contained because this file is
// loaded by every page — including user-guide.html, which has no external
// CSS — and the fixed dark palette reads fine on both themes.
// pointer-events:none so it never blocks clicks underneath it.
(function () {
  var hideTimer = null;

  function banner() {
    var el = document.getElementById("offlineBanner");
    if (el) return el;
    el = document.createElement("div");
    el.id = "offlineBanner";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.style.cssText =
      "display:none;position:fixed;left:50%;bottom:16px;" +
      "transform:translateX(-50%);z-index:10000;max-width:92vw;" +
      "padding:9px 18px;border-radius:999px;background:#1e2433;" +
      "color:#f5f7fa;border:1px solid #46516b;" +
      "box-shadow:0 4px 14px rgba(0,0,0,0.35);text-align:center;" +
      "font:600 13.5px/1.4 system-ui,-apple-system,'Segoe UI',sans-serif;" +
      "pointer-events:none;";
    document.body.appendChild(el);
    return el;
  }

  function goOffline() {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = null;
    var el = banner();
    el.textContent =
      "📴 Offline — using cached data. Regions not loaded yet won't be available.";
    el.style.display = "block";
  }

  function backOnline() {
    var el = banner();
    el.textContent = "✅ Back online.";
    el.style.display = "block";
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(function () {
      el.style.display = "none";
    }, 4000);
  }

  window.addEventListener("offline", goOffline);
  window.addEventListener("online", backOnline);
  if (navigator.onLine === false) goOffline();
})();
