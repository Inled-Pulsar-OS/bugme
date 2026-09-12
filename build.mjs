// bugme — static tracker generator. No dependencies. Produces ./site
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";

const esc = (s = "") =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const REPO_URL = "https://github.com/Inled-Pulsar-OS/bugme";
const ISOS_URL = "https://downloads-os.inled.es/isos.json";

// ---- data -----------------------------------------------------------------
let issues = [];
let comments = {};
try {
  issues = JSON.parse(readFileSync("data/issues.json", "utf8")).filter((i) => !i.pull_request);
  comments = JSON.parse(readFileSync("data/comments.json", "utf8"));
} catch {
  console.error("data/ missing — falling back to sample data.");
  issues = [
    {
      number: 1,
      title: "System does not wake up after suspend",
      state: "open",
      labels: [{ name: "bug" }, { name: "triage" }, { name: "major" }],
      user: { login: "example", avatar_url: "" },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      body: "### Edition\n\nBittenfruit\n\n### Pulsar OS version\n\n1.0-bittenfruit\n\n### Image\n\npulsaros-*-arch-refind.iso\n\n### Exact version / build\n\nPulsar OS 1.0-bittenfruit\n\n### Explain the bug\n\nThe screen stays black when resuming from suspend.\n\n### Debug information\n\n```\njournalctl: GPU hang\n```\n\n### Severity\n\nMajor — a core feature doesn't work",
      html_url: `${REPO_URL}/issues/1`,
    },
  ];
  comments = { 1: [{ user: "example", avatar: "", body: "Happens on my machine too.", created: new Date().toISOString(), url: "#" }] };
}

// ---- official versions from isos.json --------------------------------------
let isoVersions = [];
let isoEditions = [];
try {
  const res = await fetch(ISOS_URL);
  const isos = await res.json();
  isoEditions = Object.keys(isos.editions ?? {});
  isoVersions = [...new Set(
    Object.values(isos.editions ?? {}).flatMap((e) => Object.keys(e.versions ?? {}))
  )];
  console.log(`✓ isos.json — editions: ${isoEditions.join(", ")}; versions: ${isoVersions.join(", ")}`);
} catch (e) {
  console.error(`⚠ Could not fetch ${ISOS_URL}: ${e.message}. Using fallback list.`);
  isoEditions = ["Bittenfruit"];
  isoVersions = ["1.0-bittenfruit", "0.4-beta"];
}

// ---- parse issue form ------------------------------------------------------
function field(body, ...titles) {
  for (const title of titles) {
    const re = new RegExp(`### ${title}\\s*\\n+([\\s\\S]*?)(?=\\n### |$)`, "i");
    const m = body?.match(re);
    if (m && m[1].trim()) return m[1].trim();
  }
  return "";
}
const severityMeta = {
  "Critical": { color: "#d92d20", bg: "#fee4e2" },
  "Major": { color: "#b54708", bg: "#fffaeb" },
  "Moderate": { color: "#b54708", bg: "#fef0c7" },
  "Minor": { color: "#067647", bg: "#dcfae6" },
};
function severityOf(issue) {
  const raw = field(issue.body, "Gravedad", "Severity");
  const key = Object.keys(severityMeta).find((k) => raw.startsWith(k));
  return key
    ? { label: key, color: severityMeta[key].color, bg: severityMeta[key].bg }
    : { label: "Unclassified", color: "#6e6e73", bg: "#f5f5f7" };
}
// Friendly version string: prefer the exact build (About Pulsar OS), then the dropdowns (edition + version + image variant).
function versionOf(issue) {
  const detail = field(issue.body, "Versión exacta / build", "Exact version / build");
  const edition = field(issue.body, "Edition");
  const version = field(issue.body, "Versión de Pulsar OS", "Pulsar OS version");
  const image = field(issue.body, "Image");
  const iso = image?.match(/arch|debian/i)?.[0];
  const boot = image?.match(/refind|grub/i)?.[0];
  if (detail && detail !== "_No response_") {
    let out = detail;
    if (iso && boot) out += ` (${iso}-${boot})`;
    return out;
  }
  const parts = [
    edition && !edition.startsWith("Other") ? edition : "",
    version && !version.startsWith("Other") ? version : "",
  ].filter(Boolean);
  let out = parts.join(" ") || "unknown";
  if (iso && boot) out += ` (${iso}-${boot})`;
  else if (image && !image.startsWith("Other")) out += ` (${image})`;
  return out;
}
function tagsOf(issue) {
  return issue.labels.map((l) => (typeof l === "string" ? l : l.name)).filter((n) => !["bug", "triage"].includes(n));
}
function searchBlob(issue) {
  return [issue.title, issue.body ?? "", versionOf(issue), severityOf(issue).label, ...tagsOf(issue), issue.state, issue.user.login]
    .join(" ")
    .toLowerCase();
}

// Closed issues are announced on Discord and removed from the public tracker.
issues = issues.filter((i) => i.state === "open");

const issuesWithMeta = issues.map((i) => ({ ...i, sev: severityOf(i), version: versionOf(i), tags: tagsOf(i), blob: searchBlob(i) }));
const commentsKey = (n) => comments[n] ?? comments[String(n)] ?? [];

// ---- markdown-lite renderer ------------------------------------------------
function md(s = "") {
  let out = esc(s);
  out = out.replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code.replace(/^\n/, "")}</code></pre>`);
  out = out.replace(/^### (.*)$/gm, "<h4>$1</h4>");
  out = out.replace(/^## (.*)$/gm, "<h4>$1</h4>");
  out = out.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  out = out.replace(/^[-*] (.*)$/gm, "<li>$1</li>");
  out = out.replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g, "<ul>$1</ul>");
  out = out.replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>");
  return `<p>${out}</p>`;
}
const fmtDate = (d) =>
  new Date(d).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });

// ---- shared chrome ---------------------------------------------------------
const CSS = `
  :root{--blue:#0071e3;--blue-h:#0066cc;--ink:#1d1d1f;--muted:#6e6e73;
        --bg:#fff;--tint:#f5f5f7;--border:#e5e7eb;--radius:18px}
  *{box-sizing:border-box;margin:0;padding:0}
  html{scroll-behavior:smooth}
  body{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display","Helvetica Neue",Helvetica,Arial,sans-serif;
       color:var(--ink);background:var(--bg);-webkit-font-smoothing:antialiased;line-height:1.47;
       min-height:100dvh;display:flex;flex-direction:column}
  main{flex:1}
  a{color:var(--blue);text-decoration:none}a:hover{text-decoration:underline}
  .wrap{max-width:980px;margin:0 auto;padding:0 22px}
  nav{position:sticky;top:0;background:rgba(255,255,255,.8);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
      border-bottom:1px solid var(--border);z-index:50}
  nav .wrap{display:flex;align-items:center;justify-content:space-between;height:52px}
  .brand{font-weight:600;font-size:19px;color:var(--ink)}
  .brand span{color:var(--blue)}
  .tagline{color:var(--muted);font-size:13px;display:none}
  @media (min-width:760px){.tagline{display:block;margin-left:14px}}
  .searchbar{flex:0 1 300px;position:relative;margin:0 12px}
  .searchbar input{width:100%;border:1px solid var(--border);border-radius:980px;padding:7px 12px 7px 34px;
       font-size:13px;outline:none;background:#fff;transition:box-shadow .15s}
  .searchbar input:focus{box-shadow:0 0 0 3px rgba(0,113,227,.25);border-color:var(--blue)}
  .searchbar svg{position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--muted);pointer-events:none}
  .searchbar .clear{position:absolute;right:6px;top:50%;transform:translateY(-50%);border:none;background:none;
       color:var(--muted);font-size:11px;cursor:pointer;padding:4px 8px;border-radius:980px}
  .searchbar .clear:hover{color:var(--ink);background:var(--tint)}
  .btn{display:inline-block;border-radius:980px;padding:11px 22px;font-size:16px;min-height:44px;line-height:22px;margin:0 6px}
  .btn.primary{background:var(--blue);color:#fff}.btn.primary:hover{background:var(--blue-h);text-decoration:none}
  .btn.secondary{color:var(--blue);border:1px solid var(--blue)}.btn.secondary:hover{text-decoration:none;background:rgba(0,113,227,.06)}
  nav .btn{min-height:32px;padding:6px 16px;font-size:14px}
  .searchbar svg{position:absolute;left:16px;top:50%;transform:translateY(-50%);color:var(--muted);pointer-events:none}
  .searchbar input{width:100%;border:1px solid var(--border);border-radius:980px;padding:13px 88px 13px 44px;
       font-size:16px;outline:none;background:#fff;transition:box-shadow .15s}
  .searchbar input:focus{box-shadow:0 0 0 4px rgba(0,113,227,.25);border-color:var(--blue)}
  .searchbar .clear{position:absolute;right:10px;top:50%;transform:translateY(-50%);border:none;background:none;
       color:var(--muted);font-size:13px;cursor:pointer;padding:6px 10px;border-radius:980px}
  .searchbar .clear:hover{color:var(--ink);background:var(--tint)}
  section{padding:70px 0}
  section h2{font-size:clamp(30px,4vw,44px);font-weight:700;text-align:center;letter-spacing:-.01em}
  section>p.sub{text-align:center;color:var(--muted);font-size:19px;margin:10px 0 40px}
  .resultline{text-align:center;color:var(--muted);font-size:14px;margin:-24px 0 24px;min-height:20px}
  .tagrow{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-bottom:34px}
  .tag{border:1px solid var(--border);background:#fff;border-radius:980px;padding:6px 14px;font-size:13px;color:var(--ink);cursor:pointer;user-select:none;font-family:inherit}
  .tag:hover{border-color:var(--blue);color:var(--blue)}
  .tag.on{background:var(--blue);border-color:var(--blue);color:#fff}
  .issue{background:var(--tint);border-radius:var(--radius);padding:24px 26px;margin-bottom:14px;transition:transform .15s}
  .issue:hover{transform:translateY(-2px)}
  .issue-top{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
  .issue .num{color:var(--muted);font-variant-numeric:tabular-nums;font-size:14px}
  .issue h3{font-size:19px;font-weight:600;flex:1 1 300px}
  .issue h3 a{color:inherit}.issue h3 a:hover{color:var(--blue);text-decoration:none}
  .issue h3 mark{background:#ffef8a;color:inherit;border-radius:4px;padding:0 1px}
  .badge{display:inline-block;border-radius:980px;padding:3px 11px;font-size:12px;font-weight:600;white-space:nowrap}
  .badge.open{background:#dcfae6;color:#067647}.badge.closed{background:#e5e7eb;color:#6e6e73}
  .label{display:inline-block;border-radius:980px;padding:3px 11px;font-size:12px;background:#fff;border:1px solid var(--border);color:var(--muted)}
  .issue .meta{color:var(--muted);font-size:13px;margin-top:8px}
  .issue .meta mark{background:#ffef8a;border-radius:4px;padding:0 1px;color:inherit}
  .issue-body{margin-top:16px;padding-top:16px;border-top:1px solid var(--border);font-size:15px;color:#333}
  .issue-body h4{margin:16px 0 6px;font-size:15px;font-weight:600}
  .issue-body p{margin-bottom:10px;white-space:normal}
  .issue-body pre{background:#1d1d1f;color:#f5f5f7;border-radius:12px;padding:14px 16px;overflow-x:auto;margin:10px 0;font-size:13px;font-family:ui-monospace,"SF Mono",Menlo,monospace}
  .issue-body code{font-family:ui-monospace,"SF Mono",Menlo,monospace;background:rgba(0,0,0,.06);border-radius:5px;padding:1px 5px;font-size:13px}
  .issue-body pre code{background:none;padding:0}
  .comment{background:#fff;border:1px solid var(--border);border-radius:14px;padding:14px 18px;margin-top:10px;font-size:14px}
  .comment .who{display:flex;align-items:center;gap:10px;margin-bottom:6px}
  .comment img{width:26px;height:26px;border-radius:50%}
  .comment .who b{font-size:13px}.comment .who time{color:var(--muted);font-size:12px}
  .comment p{white-space:pre-wrap}
  .crumb{font-size:13px;color:var(--muted);margin-bottom:14px}
  .bug-head h2{font-size:clamp(26px,3.4vw,36px);font-weight:700;text-align:left;letter-spacing:-.01em}
  .bug-head .badges{margin-top:12px;display:flex;gap:8px;flex-wrap:wrap}
  .bug-meta{color:var(--muted);font-size:14px;margin-top:14px}
  .bug-body{background:var(--tint);border-radius:var(--radius);padding:26px 28px;margin-top:26px;font-size:15px}
  .thread h3{font-size:22px;font-weight:700;margin:44px 0 4px}
  .empty{text-align:center;color:var(--muted);padding:40px 0;font-size:17px}
  footer{border-top:1px solid var(--border);padding:34px 0;color:var(--muted);font-size:13px;text-align:center;margin-top:auto}
  @media (max-width:600px){.searchbar{flex-basis:200px}}
`;

const navHTML = ({ search = false } = {}) => `
<nav><div class="wrap">
  <div style="display:flex;align-items:center">
    <a class="brand" href="/">bug<span>me</span></a>
    <span class="tagline">Report and track Pulsar OS bugs here</span>
  </div>
  ${search ? `
  <div class="searchbar">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
    <input id="q" type="search" placeholder="Search bugs… (press /)" autocomplete="off">
    <button class="clear" id="clear" type="button">Clear</button>
  </div>` : ""}
  <a class="btn secondary" href="${REPO_URL}/issues/new?template=bug_report.yml">Report a bug</a>
</div></nav>`;

const footerHTML = `
</main>
<footer>
  bugme · bug tracker for Pulsar OS · auto-generated from GitHub Issues ·
  <a href="${REPO_URL}">GitHub</a> · <a href="${ISOS_URL}">official versions</a>
</footer>`;

// Search: text is embedded in each card's searchable spans; JS filters + highlights.
const searchJS = `
  const q = document.getElementById('q');
  const cards = [...document.querySelectorAll('.issue')];
  const tags = [...document.querySelectorAll('.tag')];
  const line = document.getElementById('resultline');
  let activeTag = null;
  function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  function strip(el){return ((el.dataset.search||'') + ' ' + [...el.querySelectorAll('[data-text]')].map(s=>s.dataset.text).join(' ')).toLowerCase();}
  function highlight(el, terms){
    // walk text nodes and wrap matches in <mark>
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes){
      const low = node.textContent.toLowerCase();
      let first = null;
      for (const t of terms){
        const idx = low.indexOf(t);
        if (idx !== -1 && (first === null || idx < first)) first = idx;
      }
      if (first === null) continue;
      const range = document.createRange();
      range.setStart(node, first);
      range.setEnd(node, Math.min(node.length, first + terms.find(t=>low.indexOf(t)===first).length));
      const mark = document.createElement('mark');
      try { range.surroundContents(mark); } catch { continue; }
    }
  }
  function apply(){
    const s = (q.value||'').toLowerCase().trim();
    const terms = s ? s.split(/\\s+/).filter(Boolean) : [];
    let shown = 0;
    for (const c of cards){
      const hay = strip(c);
      const okQ = !terms.length || terms.every(t => hay.includes(t));
      const okT = !activeTag || (c.dataset.tags||'').split('|').includes(activeTag);
      const vis = okQ && okT;
      c.style.display = vis ? '' : 'none';
      if (vis){
        shown++;
        // restore original text then highlight
        c.querySelectorAll('[data-text]').forEach(sp => { if (sp.innerHTML !== esc(sp.dataset.text)) sp.textContent = sp.dataset.text; });
        if (terms.length) c.querySelectorAll('[data-text]').forEach(sp => highlight(sp, terms));
      }
    }
    if (line) line.textContent = terms.length || activeTag ? shown + ' of ' + cards.length + ' bugs match' : '';
    const e = document.getElementById('empty');
    if (e) e.style.display = shown ? 'none' : '';
  }
  q.addEventListener('input', apply);
  document.getElementById('clear')?.addEventListener('click', () => { q.value=''; apply(); q.focus(); });
  tags.forEach(t => t.addEventListener('click', () => {
    activeTag = activeTag === t.dataset.tag ? null : t.dataset.tag;
    tags.forEach(x => x.classList.toggle('on', x.dataset.tag === activeTag));
    apply();
  }));
  // / focuses search, Esc clears
  document.addEventListener('keydown', (ev) => {
    if (ev.key === '/' && document.activeElement !== q){ ev.preventDefault(); q.focus(); }
    if (ev.key === 'Escape' && document.activeElement === q){ q.value=''; apply(); }
  });
`;

// ---- index page ------------------------------------------------------------
const allTags = [...new Set(issuesWithMeta.flatMap((i) => i.tags))].sort();
const tagChips = allTags.length
  ? `<div class="tagrow">${allTags.map((t) => `<button class="tag" data-tag="${esc(t)}">${esc(t)}</button>`).join("")}</div>`
  : "";

const issueCard = (i) => {
  const cs = commentsKey(i.number);
  const searchable = (cls, text) =>
    `<span class="${cls}" data-text="${esc(text)}">${esc(text)}</span>`;
  return `
  <article class="issue" data-search="${esc(i.blob)}" data-tags="${esc(i.tags.join("|"))}">
    <div class="issue-top">
      ${searchable("num", `#${i.number}`)}
      <h3>${searchable("t", i.title)}</h3>
      ${searchable("badge", i.sev.label)}
      ${searchable("badge open", i.state === "open" ? "Open" : "Closed")}
    </div>
    <div class="meta">
      by ${searchable("u", i.user.login)}
      · ${searchable("d", fmtDate(i.created_at))} · Version: ${searchable("v", i.version)} · ${i.tags.map((t) => searchable("label", t)).join(" ")}
      · <a href="/issues/${i.number}.html">${cs.length} comment${cs.length === 1 ? "" : "s"} →</a>
    </div>
  </article>`;
};

const cards = issuesWithMeta.length
  ? issuesWithMeta.map(issueCard).join("\n")
  : `<p class="empty" id="empty">No bugs reported yet. Everything is running smoothly! ✨</p>`;

const indexPage = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>bugme — Bug tracker for Pulsar OS</title>
<meta name="description" content="Public bug tracker for Pulsar OS. Report, search and follow every reported bug.">
<style>${CSS}</style>
</head>
<body>
<main>
${navHTML({ search: true })}

<section id="bugs" style="padding-top:48px">
  <div class="wrap">
    <div class="resultline" id="resultline"></div>
    ${tagChips}
    ${cards}
  </div>
</section>
${footerHTML}
<script>${searchJS}</script>
</body>
</html>
`;

// ---- per-issue pages -------------------------------------------------------
const issuePage = (i) => {
  const cs = commentsKey(i.number);
  const thread = cs.length
    ? `<div class="thread"><h3>Discussion (${cs.length})</h3>${cs.map((c) => `
        <div class="comment">
          <div class="who">
            ${c.avatar ? `<img src="${esc(c.avatar)}" alt="" loading="lazy">` : ""}
            <b><a href="https://github.com/${esc(c.user)}">${esc(c.user)}</a></b>
            <time>${fmtDate(c.created)}</time>
          </div>
          <p>${esc(c.body)}</p>
          ${c.url ? `<a href="${esc(c.url)}" style="font-size:12px">View on GitHub ↗</a>` : ""}
        </div>`).join("")}</div>`
    : `<p class="empty">No comments yet.</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>#${i.number} ${esc(i.title)} — bugme</title>
<meta name="description" content="${esc(i.title)} — Pulsar OS bug report">
<style>${CSS}</style>
</head>
<body>
<main>
${navHTML()}
<div class="wrap" style="padding-top:40px">
  <div class="crumb"><a href="/">← All bugs</a></div>
  <div class="bug-head">
    <h2>#${i.number} · ${esc(i.title)}</h2>
    <div class="badges">
      <span class="badge" style="background:${i.sev.bg};color:${i.sev.color}">${esc(i.sev.label)}</span>
      <span class="badge ${i.state}">${i.state === "open" ? "Open" : "Closed"}</span>
      ${i.tags.map((t) => `<span class="label">${esc(t)}</span>`).join(" ")}
    </div>
    <div class="bug-meta">
      Reported by <a href="https://github.com/${esc(i.user.login)}">${esc(i.user.login)}</a>
      · ${fmtDate(i.created_at)} · Last updated ${fmtDate(i.updated_at)}
      · Pulsar OS version: <strong>${esc(i.version)}</strong>
    </div>
  </div>
  <div class="bug-body issue-body">
    <h4>Description</h4>
    ${md(field(i.body, "Explica el error", "Explain the bug", "Describe the bug") || "—")}
    ${field(i.body, "Información de debug", "Debug information") ? `<h4>Debug information</h4>${md(field(i.body, "Información de debug", "Debug information"))}` : ""}
    <a href="${esc(i.html_url)}">View and comment on GitHub →</a>
  </div>
  ${thread}
</div>
${footerHTML}
</body>
</html>`;
};

// ---- write -----------------------------------------------------------------
rmSync("site", { recursive: true, force: true });
mkdirSync("site/issues", { recursive: true });
writeFileSync("site/index.html", indexPage);
for (const i of issuesWithMeta) writeFileSync(`site/issues/${i.number}.html`, issuePage(i));
console.log(`✓ site/ — index + ${issuesWithMeta.length} bug pages`);
