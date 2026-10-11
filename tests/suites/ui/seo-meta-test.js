// seo-meta suite: what a search result or a link preview shows for each page at the
// repository root. Each page has to be identifiable (three tool pages sharing one generic title
// would not tell AWS from Azure from GCP in a result list) and described. Covered: each page
// has a distinct title, one description of a useful length, link-preview tags that say
// the same thing as the title and description, and nothing in them that would make a
// request (no image, no script, no stylesheet).
const fs = require("fs");
const path = require("path");
const { REPO, makeChecker } = require("../harness");

const { check, state } = makeChecker();
// Every page at the repository root, so a page added later is held to the same rules.
const PAGES = fs
  .readdirSync(REPO)
  .filter((f) => f.endsWith(".html"))
  .sort();
const SITE = "https://harshit-kandhwey.github.io/Cloud-Instance-Recommender/";

const read = (rel) =>
  fs.readFileSync(path.join(REPO, rel), "utf8").replace(/\r\n/g, "\n");
const decode = (s) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
// Every <meta> tag of the page's head, as { key, content } where key is name or property.
const metas = (html) => {
  const head = html.split("</head>")[0];
  return [...head.matchAll(/<meta\b([^>]*)>/g)].map((m) => {
    const attr = (n) => {
      const a = m[1].match(new RegExp(`\\b${n}\\s*=\\s*"([^"]*)"`));
      return a ? decode(a[1]) : null;
    };
    return {
      key: attr("name") || attr("property") || attr("http-equiv"),
      content: attr("content"),
    };
  });
};
const titleOf = (html) => {
  const m = html.match(/<title>([^<]*)<\/title>/);
  return m ? decode(m[1].trim()) : null;
};

check(
  "the scan sees the seven pages it was written for",
  PAGES.length >= 7 &&
    [
      "index.html",
      "aws.html",
      "azure.html",
      "gcp.html",
      "multicloud.html",
      "app-portfolio.html",
      "user-guide.html",
    ].every((p) => PAGES.includes(p)),
  PAGES.join(", "),
);

const titles = [];
for (const page of PAGES) {
  const html = read(page);
  const all = metas(html);
  const get = (key) => all.filter((m) => m.key === key);
  const title = titleOf(html);
  titles.push(title);

  const description = get("description");
  check(
    `${page}: exactly one description, 60 to 200 characters`,
    description.length === 1 &&
      description[0].content.length >= 60 &&
      description[0].content.length <= 200,
    description.map((d) => (d.content || "").length).join(","),
  );
  check(
    `${page}: the link-preview title and description match the page's own`,
    get("og:title").length === 1 &&
      get("og:title")[0].content === title &&
      get("og:description").length === 1 &&
      description.length === 1 &&
      get("og:description")[0].content === description[0].content,
    JSON.stringify([title, get("og:title")]),
  );
  const url = get("og:url");
  check(
    `${page}: the preview URL names this page on the live site`,
    url.length === 1 &&
      url[0].content === SITE + (page === "index.html" ? "" : page),
    JSON.stringify(url),
  );
  check(
    `${page}: type, site name and card are present`,
    get("og:type").length === 1 &&
      get("og:type")[0].content === "website" &&
      get("og:site_name").length === 1 &&
      get("twitter:card").length === 1 &&
      get("twitter:card")[0].content === "summary",
  );
  check(
    `${page}: no preview image, so the tags request nothing`,
    get("og:image").length === 0 && get("twitter:image").length === 0,
  );
}
check(
  "the page titles are all different",
  new Set(titles).size === PAGES.length,
  JSON.stringify(titles),
);

// The scan has to see what it claims to: the helper reads a tag with an ampersand.
{
  const sample =
    '<head><meta name="description" content="a &amp; b" /></head><title>t</title>';
  const m = metas(sample).find((x) => x.key === "description");
  check(
    "the tag reader decodes an escaped ampersand",
    m && m.content === "a & b",
    JSON.stringify(m),
  );
}

if (state.failures) {
  console.error(`\nseo-meta: ${state.failures} check(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log("\nseo-meta: all checks passed");
  process.exitCode = 0;
}
