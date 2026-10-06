// One delegated listener per event type for the tool pages' controls (3.21 phase 5).
// A control names the global function to run in data-on-click or data-on-change.
// Arguments come from data-args, a JSON array, so numbers stay numbers. An object
// marker stands in for a value only the browser knows: {"$":"this"} the element,
// {"$":"value"} its value, {"$":"checked"} its checked state, {"$":"event"} the event.
// A user's text is never an object, so it cannot be mistaken for a marker. The older
// data-this and data-arg forms are still read. data-then runs a second global after
// the first. Inline handler attributes are not used, so the CSP can drop
// 'unsafe-inline' for scripts.
// Applies data-style declarations to a node and its descendants. A MutationObserver
// runs it for every inserted node before the next paint, so no renderer has to call it.
function applyDataStyles(node) {
  if (!node || node.nodeType !== 1) return;
  var targets = node.hasAttribute("data-style") ? [node] : [];
  targets = targets.concat(
    Array.prototype.slice.call(node.querySelectorAll("[data-style]")),
  );
  targets.forEach(function (el) {
    var decls = JSON.parse(el.getAttribute("data-style"));
    Object.keys(decls).forEach(function (k) {
      el.style.setProperty(k, decls[k]);
    });
  });
}

if (typeof MutationObserver === "function") {
  new MutationObserver(function (records) {
    records.forEach(function (r) {
      Array.prototype.forEach.call(r.addedNodes, applyDataStyles);
    });
  }).observe(document.documentElement, { childList: true, subtree: true });
}

(function () {
  function resolve(arg, el, event) {
    if (arg !== null && typeof arg === "object" && "$" in arg) {
      if (arg.$ === "this") return el;
      if (arg.$ === "value") return el.value;
      if (arg.$ === "checked") return el.checked;
      if (arg.$ === "event") return event;
    }
    return arg;
  }

  ["click", "change", "input", "keydown", "blur"].forEach(function (type) {
    var attr = "data-on-" + type;
    // blur does not bubble, so it is caught in the capture phase.
    document.addEventListener(
      type,
      /** @param {Event & { key?: string }} event */
      function (event) {
        var target = /** @type {Element | null} */ (event.target);
        var el =
          target && target.closest ? target.closest("[" + attr + "]") : null;
        if (!el) return;
        var sfx = "-" + type;
        if (el.hasAttribute("data-keys" + sfx)) {
          var keys = JSON.parse(
            /** @type {string} */ (el.getAttribute("data-keys" + sfx)),
          );
          if (keys.indexOf(event.key) === -1) return;
        }
        /** @type {Function | undefined} */
        var fn = window[String(el.getAttribute(attr))];
        if (typeof fn !== "function") return;
        if (el.hasAttribute("data-prevent" + sfx)) event.preventDefault();
        if (el.hasAttribute("data-stop" + sfx)) event.stopPropagation();
        if (el.hasAttribute("data-args" + sfx)) {
          var list = JSON.parse(
            /** @type {string} */ (el.getAttribute("data-args" + sfx)),
          );
          fn.apply(
            el,
            list.map(function (a) {
              return resolve(a, el, event);
            }),
          );
        } else if (el.hasAttribute("data-this")) fn.call(el, el);
        else if (el.hasAttribute("data-arg"))
          fn.call(el, el.getAttribute("data-arg"));
        else fn.call(el);
        var then = el.getAttribute("data-then" + sfx);
        if (then && typeof window[then] === "function") window[then]();
      },
      type === "blur",
    );
  });
})();
