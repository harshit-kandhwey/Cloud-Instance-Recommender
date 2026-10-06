// The theme script (src/shared/theme-init.js) runs in every page's head before first
// paint and defines window.toggleTheme. Covered here: which theme a page opens with
// (a saved choice wins, otherwise the OS), what the toggle does and persists, that a
// browser which blocks storage or lacks matchMedia degrades instead of throwing, and
// that an OS change moves the page only while the user has not picked a theme.
const { buildEngineContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();

/**
 * @param {{ stored?: string, osDark?: boolean, storageThrows?: boolean, noMatchMedia?: boolean, noButton?: boolean }} [options]
 */
function setup({ stored, osDark, storageThrows, noMatchMedia, noButton } = {}) {
  const { ctx, load, run } = buildEngineContext({
    scripts: ["src/shared/storage-keys.js"],
  });
  const key = run("STORAGE_KEYS.theme");
  const store = {};
  if (stored !== undefined) store[key] = stored;
  ctx.localStorage = {
    getItem: (k) => {
      if (storageThrows) throw new Error("storage blocked");
      return k in store ? store[k] : null;
    },
    setItem: (k, v) => {
      if (storageThrows) throw new Error("storage blocked");
      store[k] = String(v);
    },
  };
  const listeners = [];
  if (!noMatchMedia) {
    ctx.matchMedia = () => ({
      matches: !!osDark,
      addEventListener: (type, fn) => listeners.push([type, fn]),
    });
  }
  const button = {
    attrs: {},
    setAttribute(k, v) {
      this.attrs[k] = v;
    },
  };
  const domListeners = [];
  ctx.document = {
    documentElement: { dataset: {} },
    getElementById: (id) => (id === "themeToggle" && !noButton ? button : null),
    addEventListener: (type, fn) => domListeners.push([type, fn]),
  };
  load("src/shared/theme-init.js");
  return {
    ctx,
    key,
    store,
    listeners,
    button,
    theme: () => ctx.document.documentElement.dataset.theme,
    // The button does not exist while the head script runs; the page reaches this
    // point when the document has been parsed.
    documentLoaded: () =>
      domListeners
        .filter(([type]) => type === "DOMContentLoaded")
        .forEach(([, fn]) => fn()),
  };
}

console.log("[the theme a page opens with]");
check(
  "no saved choice, OS light: light",
  setup({ osDark: false }).theme() === "light",
);
check(
  "no saved choice, OS dark: dark",
  setup({ osDark: true }).theme() === "dark",
);
check(
  "a saved dark choice beats a light OS",
  setup({ stored: "dark", osDark: false }).theme() === "dark",
);
check(
  "a saved light choice beats a dark OS",
  setup({ stored: "light", osDark: true }).theme() === "light",
);
check(
  "a saved value that is neither theme is ignored and the OS decides",
  setup({ stored: "purple", osDark: true }).theme() === "dark" &&
    setup({ stored: "", osDark: false }).theme() === "light",
);
check(
  "a browser without matchMedia opens light instead of throwing",
  setup({ noMatchMedia: true }).theme() === "light",
);
check(
  "a browser that blocks storage still opens, following the OS",
  setup({ storageThrows: true, osDark: true }).theme() === "dark",
);

console.log("[the toggle flips, persists and tells assistive technology]");
{
  const t = setup({ osDark: false });
  t.ctx.toggleTheme();
  check("light becomes dark", t.theme() === "dark");
  check(
    "the choice is saved",
    t.store[t.key] === "dark",
    JSON.stringify(t.store),
  );
  check(
    "the button reports it is pressed",
    t.button.attrs["aria-pressed"] === "true",
    JSON.stringify(t.button.attrs),
  );
  t.ctx.toggleTheme();
  check("dark becomes light", t.theme() === "light");
  check("and that choice is saved over the first", t.store[t.key] === "light");
  check(
    "the button reports it is no longer pressed",
    t.button.attrs["aria-pressed"] === "false",
  );
}
{
  const t = setup({ storageThrows: true });
  let threw = false;
  try {
    t.ctx.toggleTheme();
  } catch {
    threw = true;
  }
  check(
    "with storage blocked the toggle still switches the page, and does not throw",
    !threw && t.theme() === "dark",
  );
}
{
  const t = setup({ noButton: true });
  let threw = false;
  try {
    t.ctx.toggleTheme();
  } catch {
    threw = true;
  }
  check(
    "a page without the toggle button can still be toggled",
    !threw && t.theme() === "dark",
  );
}

console.log("[the button reports the theme the page opened with]");
{
  const dark = setup({ stored: "dark", osDark: false });
  check(
    "nothing is set before the document is parsed",
    !("aria-pressed" in dark.button.attrs),
    JSON.stringify(dark.button.attrs),
  );
  dark.documentLoaded();
  check(
    "a saved dark choice opens with the button pressed, before any click",
    dark.button.attrs["aria-pressed"] === "true",
    JSON.stringify(dark.button.attrs),
  );
  const osDark = setup({ osDark: true });
  osDark.documentLoaded();
  check(
    "an OS-dark page opens with the button pressed",
    osDark.button.attrs["aria-pressed"] === "true",
  );
  const light = setup({ stored: "light", osDark: true });
  light.documentLoaded();
  check(
    "a light page opens with the button not pressed",
    light.button.attrs["aria-pressed"] === "false",
    JSON.stringify(light.button.attrs),
  );
  const noButton = setup({ stored: "dark", noButton: true });
  let threw = false;
  try {
    noButton.documentLoaded();
  } catch {
    threw = true;
  }
  check("a page without the button loads without throwing", !threw);
}
{
  const t = setup({ osDark: false });
  t.documentLoaded();
  t.listeners[0][1]({ matches: true });
  check(
    "an OS switch to dark, with no saved choice, updates the button too",
    t.button.attrs["aria-pressed"] === "true",
    JSON.stringify(t.button.attrs),
  );
}

console.log("[the OS setting moves the page only while no theme is chosen]");
{
  const t = setup({ osDark: false });
  const [type, fn] = t.listeners[0] || [];
  check(
    "the page listens for OS theme changes",
    type === "change" && typeof fn === "function",
  );
  fn({ matches: true });
  check(
    "with no saved choice an OS switch to dark is followed",
    t.theme() === "dark",
  );
  fn({ matches: false });
  check("and back to light", t.theme() === "light");
}
{
  const t = setup({ stored: "light", osDark: false });
  t.listeners[0][1]({ matches: true });
  check("with a saved choice an OS change is ignored", t.theme() === "light");
}
{
  const t = setup({ osDark: false });
  t.ctx.toggleTheme();
  t.listeners[0][1]({ matches: false });
  check(
    "toggling counts as choosing: the page then stays on the user's pick",
    t.theme() === "dark",
  );
}

process.exitCode = state.failures ? 1 : 0;
