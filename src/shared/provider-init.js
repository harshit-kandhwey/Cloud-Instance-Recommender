// Runs the page's provider toggle once the document is parsed. Loaded as a blocking
// script in the head so this listener registers before the deferred page scripts,
// which keeps the toggle ahead of their own DOMContentLoaded setup. The provider comes
// from the body's data-provider attribute; a page without one (multicloud) does nothing.
document.addEventListener("DOMContentLoaded", function () {
  var provider = document.body.getAttribute("data-provider");
  if (provider) toggleCloudProvider(provider);
});
