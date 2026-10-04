// Sets the theme before first paint. Loaded as a blocking script in every page's
// head: a deferred script would flash the wrong theme. A saved choice wins; otherwise
// the page follows the OS setting until the user picks one.
(function () {
  var stored = null;
  try {
    stored = localStorage.getItem(STORAGE_KEYS.theme);
  } catch (e) {}
  var mql =
    window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");
  document.documentElement.dataset.theme =
    stored === "dark" || stored === "light"
      ? stored
      : mql && mql.matches
        ? "dark"
        : "light";
  window.toggleTheme = function () {
    var next =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(STORAGE_KEYS.theme, next);
    } catch (e) {}
    var btn = document.getElementById("themeToggle");
    if (btn) btn.setAttribute("aria-pressed", next === "dark");
  };
  if (mql && mql.addEventListener) {
    mql.addEventListener("change", function (e) {
      var saved = null;
      try {
        saved = localStorage.getItem(STORAGE_KEYS.theme);
      } catch (err) {}
      if (saved !== "dark" && saved !== "light") {
        document.documentElement.dataset.theme = e.matches ? "dark" : "light";
      }
    });
  }
})();
