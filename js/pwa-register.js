// Registers the offline service worker (see sw.js). Guarded so it no-ops
// where service workers aren't supported or there's no secure context
// (e.g. file://), leaving the app fully functional without offline support.
// Shared by every page so the registration/update flow lives in one place.
if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  });
}
