// The results table's Columns menu is a native <details>. Its open state is remembered so
// that a re-render after a column is toggled does not snap it shut. `toggle` does not
// bubble, so the menu is wired directly after each render, and the strict CSP forbids the
// inline handler it once used: without the listener the state never updates and the menu
// closes after every click.
const { buildContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();

const ROWS = [
  {
    "VM Name": "web-01",
    "CPU Count": "4",
    "Memory (GB)": "16",
    ENV: "Production",
    "AWS Like-to-Like Instance": "m5.xlarge",
  },
];

function setup() {
  const { ctx, elements } = buildContext();
  const menu = {
    open: false,
    listeners: {},
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    },
  };
  const real = ctx.document.getElementById;
  ctx.document.getElementById = (id) =>
    id === "previewColsMenu" ? menu : real(id);
  ctx.showResultsPreview(ROWS);
  return { ctx, elements, menu };
}

console.log("[the Columns menu keeps its open state across a re-render]");
{
  const { ctx, elements, menu } = setup();
  const html = () => elements.resultsPreviewSection.innerHTML;

  check(
    "the markup carries no inline handler on the menu",
    html().includes('id="previewColsMenu"') && !/\bontoggle\s*=/.test(html()),
  );
  check(
    "a toggle listener is attached to the menu after the render",
    typeof menu.listeners.toggle === "function",
  );
  check(
    "the menu starts closed",
    !/id="previewColsMenu" open/.test(html()) &&
      ctx._previewState.colsMenuOpen === false,
  );

  menu.open = true;
  menu.listeners.toggle();
  check(
    "opening the menu is remembered",
    ctx._previewState.colsMenuOpen === true,
  );

  ctx._previewToggleColumn(0, false);
  check(
    "a re-render after a column toggle keeps the menu open",
    /id="previewColsMenu" open/.test(html()),
    html()
      .slice(html().indexOf("previewColsMenu") - 40)
      .slice(0, 160),
  );

  menu.open = false;
  menu.listeners.toggle();
  ctx._previewToggleColumn(0, true);
  check(
    "closing it is remembered too, so the next re-render leaves it closed",
    !/id="previewColsMenu" open/.test(html()) &&
      ctx._previewState.colsMenuOpen === false,
  );
}

process.exitCode = state.failures ? 1 : 0;
