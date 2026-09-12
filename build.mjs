// bugme — static tracker generator. No dependencies. Produces ./site
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";

const esc = (s = "") =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const escAttr = esc;

// ---- data -----------------------------------------------------------------
if (!existsSync("data/issues.json")) {
  console.error("Run the GitHub Action first — data/issues.json missing. Falling back to sample data.");
}
let issues = [];
let comments = {};
try {
  issues = JSON.parse(readFileSync("data/issues.json", "utf8")).filter((i) => !i.pull_request);
  comments = JSON.parse(readFileSync("data/comments.json", "utf8"));
} catch {
  issues = [
    {
      number: 1,
      title: "El sistema no despierta tras suspender",
      state: "open",
      labels: [{ name: "bug" }, { name: "triage" }],
      user: { login: "ejemplo", avatar_url: "" },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      body: "### Versión de Pulsar OS\n\npulsaros-stable-arch-refind.iso\n\n### Explica el error\n\nLa pantalla se queda negra al reanudar.\n\n### Información de debug\n\n```\njournalctl: GPU hang\n```\n\n### Gravedad\n\nGrave — una función principal no funciona",
      html_url: "#",
    },
  ];
  comments = { 1: [] };
}

// ---- parse issue form ------------------------------------------------------
function field(body, title) {
  const re = new RegExp(`### ${title}\\s*\\n+([\\s\\S]*?)(?=\\n### |$)`, "i");
  const m = body?.match(re);
  return m ? m[1].trim() : "";
}
const severityMeta = {
  "Crítico": { color: "#d92d20", bg: "#fee4e2" },
  "Grave": { color: "#b54708", bg: "#fffaeb" },
  "Moderado": { color: "#b54708", bg: "#fef0c7" },
  "Menor": { color: "#067647", bg: "#dcfae6" },
};
function severityOf(issue) {
  const raw = field(issue.body, "Gravedad");
  const key = Object.keys(severityMeta).find((k) => raw.startsWith(k));
  return { label: key ?? "Sin clasificar", ...(key ? severityMeta[key] : { color: "#6e6e73", bg: "#f5f5f7" }) };
}
function versionOf(issue) {
  return field(issue.body, "Versión de Pulsar OS").replace(/\r/g, "") || "desconocida";
}

const open = issues.filter((i) => i.state === "open").length;
const bySeverity = {};
for (const i of issues) {
  const s = severityOf(i).label;
  bySeverity[s] = (bySeverity[s] ?? 0) + 1;
}

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

// ---- pages ----------------------------------------------------------------
const CSS = `
  :root{
    --blue:#0071e3; --blue-h:#0066cc; --ink:#1d1d1f; --muted:#6e6e73;
    --bg:#fff; --tint:#f5f5f7; --border:#e5e7eb; --radius:18px;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html{scroll-behavior:smooth}
  body{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display","Helvetica Neue",Helvetica,Arial,sans-serif;
       color:var(--ink);background:var(--bg);-webkit-font-smoothing:antialiased;line-height:1.47}
  a{color:var(--blue);text-decoration:none}a:hover{text-decoration:underline}
  .wrap{max-width:980px;margin:0 auto;padding:0 22px}

  nav{position:sticky;top:0;background:rgba(255,255,255,.8);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
      border-bottom:1px solid var(--border);z-index:50}
  nav .wrap{display:flex;align-items:center;justify-content:space-between;height:52px}
  .brand{font-weight:600;font-size:19px;color:var(--ink)}
  .brand span{color:var(--blue)}

  .hero{background:var(--tint);text-align:center;padding:110px 0 90px}
  .hero h1{font-size:clamp(44px,7vw,72px);font-weight:700;letter-spacing:-.015em}
  .hero h1 span{color:var(--blue)}
  .hero p{font-size:clamp(19px,2.6vw,24px);color:var(--muted);margin:14px auto 30px;max-width:620px}
  .btn{display:inline-block;border-radius:980px;padding:11px 22px;font-size:16px;min-height:44px;line-height:22px;margin:0 6px}
  .btn.primary{background:var(--blue);color:#fff}.btn.primary:hover{background:var(--blue-h);text-decoration:none}
  .btn.secondary{color:var(--blue);border:1px solid var(--blue)}.btn.secondary:hover{text-decoration:none;background:rgba(0,113,227,.06)}

  .stats{display:flex;gap:16px;justify-content:center;flex-wrap:wrap;margin-top:54px}
  .stat{background:#fff;border:1px solid var(--border);border-radius:var(--radius);padding:18px 30px;min-width:130px}
  .stat b{display:block;font-size:32px;font-weight:700}
  .stat span{color:var(--muted);font-size:13px}

  section{padding:90px 0}
  section h2{font-size:clamp(30px,4vw,44px);font-weight:700;text-align:center;letter-spacing:-.01em}
  section>p.sub{text-align:center;color:var(--muted);font-size:19px;margin:10px 0 46px}

  .issue{background:var(--tint);border-radius:var(--radius);padding:26px 28px;margin-bottom:16px;cursor:pointer}
  .issue summary{list-style:none;display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap}
  .issue summary::-webkit-details-marker{display:none}
  .issue .num{color:var(--muted);font-variant-numeric:tabular-nums;font-size:14px;padding-top:3px}
  .issue h3{font-size:19px;font-weight:600;flex:1 1 300px}
  .badge{display:inline-block;border-radius:980px;padding:3px 11px;font-size:12px;font-weight:600;white-space:nowrap}
  .badge.open{background:#dcfae6;color:#067647}.badge.closed{background:#e5e7eb;color:#6e6e73}
  .badge.sev{color:#1d1d1f}
  .issue .meta{width:100%;color:var(--muted);font-size:13px;margin-top:6px}
  .issue-body{margin-top:18px;padding-top:18px;border-top:1px solid var(--border);font-size:15px;color:#333}
  .issue-body h4{margin:16px 0 6px;font-size:15px;font-weight:600}
  .issue-body p{margin-bottom:10px;white-space:normal}
  .issue-body pre{background:#1d1d1f;color:#f5f5f7;border-radius:12px;padding:14px 16px;overflow-x:auto;margin:10px 0;font-size:13px;font-family:ui-monospace,"SF Mono",Menlo,monospace}
  .issue-body code{font-family:ui-monospace,"SF Mono",Menlo,monospace;background:rgba(0,0,0,.06);border-radius:5px;padding:1px 5px;font-size:13px}
  .issue-body pre code{background:none;padding:0}
  .thread{margin-top:18px}
  .comment{background:#fff;border:1px solid var(--border);border-radius:14px;padding:14px 18px;margin-top:10px;font-size:14px}
  .comment .who{display:flex;align-items:center;gap:10px;margin-bottom:6px}
  .comment img{width:26px;height:26px;border-radius:50%}
  .comment .who b{font-size:13px}.comment .who time{color:var(--muted);font-size:12px}
  .comment p{white-space:pre-wrap}
  .thread-link{display:inline-block;margin-top:12px;font-size:14px}

  .empty{text-align:center;color:var(--muted);padding:40px 0;font-size:17px}

  footer{border-top:1px solid var(--border);padding:34px 0;color:var(--muted);font-size:13px;text-align:center}
  @media (max-width:600px){.hero{padding:80px 0 60px}.stat{min-width:100px;padding:14px 20px}}
`;

const commentsFor = (n) => comments[n] ?? [];

const issueCard = (i) => {
  const sev = severityOf(i);
  const cs = commentsFor(i.number);
  return `
  <details class="issue" id="issue-${i.number}">
    <summary>
      <span class="num">#${i.number}</span>
      <h3>${esc(i.title)}</h3>
      <span class="badge sev" style="background:${sev.bg};color:${sev.color}">${esc(sev.label)}</span>
      <span class="badge ${i.state}">${i.state === "open" ? "Abierto" : "Cerrado"}</span>
    </summary>
    <div class="meta">
      Reportado por <a href="https://github.com/${esc(i.user.login)}">${esc(i.user.login)}</a>
      · ${new Date(i.created_at).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" })}
      · Versión: ${esc(versionOf(i))} · ${cs.length} comentario${cs.length === 1 ? "" : "s"}
    </div>
    <div class="issue-body">${md(field(i.body, "Explica el error"))}
      ${field(i.body, "Información de debug") ? `<h4>Debug</h4>${md(field(i.body, "Información de debug"))}` : ""}
      ${cs.length ? `<div class="thread"><h4>Comentarios</h4>${cs.map((c) => `
        <div class="comment">
          <div class="who">
            ${c.avatar ? `<img src="${esc(c.avatar)}" alt="" loading="lazy">` : ""}
            <b>${esc(c.user)}</b><time>${new Date(c.created).toLocaleDateString("es-ES")}</time>
          </div>
          <p>${esc(c.body)}</p>
        </div>`).join("")}</div>` : ""}
      <a class="thread-link" href="${esc(i.html_url)}">Ver hilo completo en GitHub →</a>
    </div>
  </details>`;
};

const cards = issues.length
  ? issues.map(issueCard).join("\n")
  : `<p class="empty">Aún no hay errores reportados. ¡Todo va de maravilla! ✨</p>`;

const sevStats = Object.entries(bySeverity)
  .map(([k, v]) => `<div class="stat"><b>${v}</b><span>${esc(k)}</span></div>`)
  .join("");

const page = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>bugme — Tracker de errores de Pulsar OS</title>
<meta name="description" content="Tracker público de errores de Pulsar OS. Reporta, sigue y comenta.">
<style>${CSS}</style>
</head>
<body>
<nav><div class="wrap">
  <a class="brand" href="#">bug<span>me</span></a>
  <a class="btn secondary" style="min-height:32px;padding:6px 16px;font-size:14px" href="https://github.com/${esc(process.env.GITHUB_REPOSITORY || "OWNER/bugme")}/issues/new?template=bug_report.yml">Reportar bug</a>
</div></nav>

<header class="hero">
  <h1>bug<span>me</span></h1>
  <p>Cada error de Pulsar OS, reportado, rastreado y comentado en un solo sitio.</p>
  <div>
    <a class="btn primary" href="https://github.com/${esc(process.env.GITHUB_REPOSITORY || "OWNER/bugme")}/issues/new?template=bug_report.yml">Reportar un error</a>
    <a class="btn secondary" href="#issues">Ver errores</a>
  </div>
  <div class="stats">
    <div class="stat"><b>${open}</b><span>Abiertos</span></div>
    <div class="stat"><b>${issues.length - open}</b><span>Cerrados</span></div>
    <div class="stat"><b>${issues.length}</b><span>Total</span></div>
    ${sevStats}
  </div>
</header>

<section id="issues">
  <h2>Todos los errores</h2>
  <p class="sub">Haz clic en un error para ver la descripción, el debug y el hilo de comentarios.</p>
  <div class="wrap">
    ${cards}
  </div>
</section>

<footer>
  bugme · tracker de errores de Pulsar OS · generado automáticamente desde GitHub Issues ·
  <a href="https://github.com/${esc(process.env.GITHUB_REPOSITORY || "OWNER/bugme")}">GitHub</a>
</footer>
</body>
</html>
`;

rmSync("site", { recursive: true, force: true });
mkdirSync("site", { recursive: true });
writeFileSync("site/index.html", page);
console.log(`✓ site/index.html — ${issues.length} issues, ${open} abiertos`);
