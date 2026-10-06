// form-controls.js reads live checkbox groups through queryInputs. The shared DOM stub
// answers only script[src], so this suite supplies the selector answers itself and checks
// what the readers do with them: the inputs come back as a real array in document order,
// and a reader keeps each checked box's value and skips a box with none.
const { buildContext, makeChecker } = require("../harness");

const { check, state } = makeChecker();

function setup(answer) {
  const { ctx } = buildContext();
  const asked = [];
  ctx.document.querySelectorAll = (selector) => {
    asked.push(selector);
    return answer(selector);
  };
  return { ctx, asked };
}

const boxes = (...values) => values.map((value) => ({ value }));
// What querySelectorAll really returns: indexed and sized, but not an array.
const liveList = (items) =>
  Object.assign(
    { length: items.length },
    Object.fromEntries(items.map((el, i) => [i, el])),
  );

console.log("[queryInputs hands back the matching inputs]");
{
  const found = boxes("a", "b", "c");
  const { ctx, asked } = setup(() => liveList(found));
  const got = ctx.queryInputs("input[type=checkbox]:checked");
  check("it is a real array", Array.isArray(got));
  check(
    "it holds the same elements in the same order",
    got.length === 3 && got.every((el, i) => el === found[i]),
    JSON.stringify(got),
  );
  check(
    "the selector reaches the document unchanged",
    asked.length === 1 && asked[0] === "input[type=checkbox]:checked",
    JSON.stringify(asked),
  );
  check(
    "no match gives an empty array, not null",
    Array.isArray(setup(() => liveList([])).ctx.queryInputs("x")) &&
      setup(() => liveList([])).ctx.queryInputs("x").length === 0,
  );
}

console.log("[the selection readers keep each checked box's value]");
{
  const { ctx } = setup(() => liveList(boxes("AMD", "Intel")));
  check(
    "processor manufacturers are the checked values, in order",
    JSON.stringify(ctx.getSelectedProcessorManufacturers()) ===
      JSON.stringify(["AMD", "Intel"]),
    JSON.stringify(ctx.getSelectedProcessorManufacturers()),
  );
  check(
    "instance family names are the checked values, in order",
    JSON.stringify(ctx.getSelectedInstanceFamilyNames()) ===
      JSON.stringify(["AMD", "Intel"]),
  );
}
{
  const { ctx } = setup(() => liveList(boxes("AMD", "", "Intel")));
  check(
    "a box with no value is skipped",
    JSON.stringify(ctx.getSelectedProcessorManufacturers()) ===
      JSON.stringify(["AMD", "Intel"]),
    JSON.stringify(ctx.getSelectedProcessorManufacturers()),
  );
}
{
  const { ctx } = setup(() => liveList([]));
  check(
    "nothing checked reads as an empty selection",
    ctx.getSelectedProcessorManufacturers().length === 0 &&
      ctx.getSelectedInstanceFamilyNames().length === 0,
  );
}

process.exitCode = state.failures ? 1 : 0;
