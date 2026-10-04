// One delegated listener per event type for the tool pages' controls (3.21 phase 5).
// A control names the global function to run in data-on-click or data-on-change.
// data-this passes the element (as the old inline `this` did), data-arg passes one
// string, and data-then runs a second global after the first. Inline handler
// attributes are not used, so the CSP can drop 'unsafe-inline' for scripts.
(function () {
  ["click", "change"].forEach(function (type) {
    var attr = "data-on-" + type;
    document.addEventListener(type, function (event) {
      var target = event.target;
      var el =
        target && target.closest ? target.closest("[" + attr + "]") : null;
      if (!el) return;
      var fn = window[el.getAttribute(attr)];
      if (typeof fn !== "function") return;
      if (el.hasAttribute("data-this")) fn.call(el, el);
      else if (el.hasAttribute("data-arg"))
        fn.call(el, el.getAttribute("data-arg"));
      else fn.call(el);
      var then = el.getAttribute("data-then");
      if (then && typeof window[then] === "function") window[then]();
    });
  });
})();
