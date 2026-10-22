// Zero-dependency static build: content/*.json + templates/*.html -> dist/
// Usage: node scripts/build.mjs [--out <dir>]
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync, openSync, readSync, closeSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const readText = (path) => readFileSync(join(root, path), "utf8");

const readJson = (path, fallback) => {
  const file = join(root, path);
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${error.message}`);
  }
};

/* Templates: {{value}} is escaped, {{{value}}} is raw, {{#if value}}…{{/if}} is optional. */

export const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const lookup = (ctx, path) => path.split(".").reduce((value, key) => (value == null ? undefined : value[key]), ctx);

const present = (value) =>
  Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== false && value !== "";

// Innermost {{#if}} first, so blocks can nest.
const IF_BLOCK = /{{#if ([\w.]+)}}((?:(?!{{#if )[\s\S])*?){{\/if}}/;

export function render(template, ctx) {
  let out = template;
  let match;
  while ((match = IF_BLOCK.exec(out))) {
    out = out.slice(0, match.index) + (present(lookup(ctx, match[1])) ? match[2] : "") + out.slice(match.index + match[0].length);
  }
  // One pass, so inserted values are never re-scanned for {{ }}.
  return out.replace(/{{{\s*([\w.]+)\s*}}}|{{\s*([\w.]+)\s*}}/g, (_, raw, escaped) => {
    const value = lookup(ctx, raw || escaped);
    if (value == null) return "";
    return raw ? String(value) : escapeHtml(value);
  });
}

const partials = {};
const partial = (name, ctx) => {
  partials[name] ??= readText(`templates/partials/${name}.html`);
  return render(partials[name], ctx);
};

/* Python highlighting for code windows: keywords, names, comments. Everything is escaped. */

const PY_KEYWORDS = new Set(
  "False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield".split(" ")
);
const PY_TOKEN = /("""[\s\S]*?"""|'''[\s\S]*?''')|(#.*)|([rbfuRBFU]{0,2}"(?:\\.|[^"\\])*"|[rbfuRBFU]{0,2}'(?:\\.|[^'\\])*')|(@[\w.]+)|([A-Za-z_]\w*)|([\s\S])/g;

const comment = (text) => (text ? `<span class="c">${escapeHtml(text)}</span>` : "");

function pythonTokens(line) {
  let out = "";
  let previous = "";
  for (const [token, doc, hash, string, decorator, word] of line.matchAll(PY_TOKEN)) {
    if (doc || hash) out += comment(token);
    else if (string) out += escapeHtml(token);
    else if (decorator) out += `<span class="n">${escapeHtml(token)}</span>`;
    else if (word) {
      if (PY_KEYWORDS.has(word)) out += `<span class="k">${word}</span>`;
      else if (previous === "def" || previous === "class" || /^[A-Z]/.test(word)) out += `<span class="n">${word}</span>`;
      else out += word;
      previous = word;
      continue;
    } else out += escapeHtml(token);
    if (!/\s/.test(token)) previous = "";
  }
  return out;
}

// state.doc carries an open triple-quoted docstring across lines.
function highlightPython(line, state) {
  if (state.doc) {
    const end = line.indexOf(state.doc);
    if (end < 0) return comment(line);
    state.doc = null;
    return comment(line.slice(0, end + 3)) + highlightPython(line.slice(end + 3), state);
  }
  for (const quote of ['"""', "'''"]) {
    if (line.split(quote).length % 2 === 0) {
      const start = line.lastIndexOf(quote);
      state.doc = quote;
      return pythonTokens(line.slice(0, start)) + comment(line.slice(start));
    }
  }
  return pythonTokens(line);
}

/* PHP highlighting: same three colours (keywords, names, comments). */

const PHP_KEYWORDS = new Set(
  "function return if else elseif static try catch finally new null true false exit require_once require include include_once foreach for while as echo const class public private protected throw use namespace array".split(" ")
);
const PHP_TOKEN = /(\/\/.*|#.*)|(\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(\$\w+)|([A-Za-z_]\w*)|([\s\S])/g;

function phpTokens(line) {
  let out = "";
  let previous = "";
  for (const [token, hash, block, string, variable, word] of line.matchAll(PHP_TOKEN)) {
    if (hash || block) out += comment(token);
    else if (string || variable) out += escapeHtml(token);
    else if (word) {
      if (PHP_KEYWORDS.has(word.toLowerCase())) out += `<span class="k">${word}</span>`;
      else if (previous === "function" || /^[A-Z]/.test(word)) out += `<span class="n">${word}</span>`;
      else out += word;
      previous = word.toLowerCase();
      continue;
    } else out += escapeHtml(token);
    if (!/\s/.test(token)) previous = "";
  }
  return out;
}

// state.block carries an open /* … */ comment across lines.
function highlightPhp(line, state) {
  if (state.block) {
    const end = line.indexOf("*/");
    if (end < 0) return comment(line);
    state.block = false;
    return comment(line.slice(0, end + 2)) + highlightPhp(line.slice(end + 2), state);
  }
  const open = line.lastIndexOf("/*");
  if (open > -1 && line.indexOf("*/", open) < 0 && !line.slice(0, open).includes("//")) {
    state.block = true;
    return phpTokens(line.slice(0, open)) + comment(line.slice(open));
  }
  return phpTokens(line);
}

const HIGHLIGHTERS = { python: highlightPython, php: highlightPhp };

function codeLines(snippet, lang) {
  const state = {};
  return String(snippet)
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => {
      const level = Math.min(Math.floor((line.match(/^ */)[0].length) / 4), 6);
      const highlight = HIGHLIGHTERS[lang];
      const body = line === "" ? " " : highlight ? highlight(line, state) : escapeHtml(line);
      return `<span class="ln i${level}">${body}</span>`;
    })
    .join("");
}

/* Image dimensions (PNG, JPEG, WebP, GIF) so every <img> gets width/height and nothing shifts. */

function imageSize(file) {
  const fd = openSync(file, "r");
  const buffer = Buffer.alloc(65536);
  const length = readSync(fd, buffer, 0, buffer.length, 0);
  closeSync(fd);
  const b = buffer.subarray(0, length);
  if (b.toString("ascii", 1, 4) === "PNG") return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.toString("ascii", 0, 3) === "GIF") return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const chunk = b.toString("ascii", 12, 16);
    if (chunk === "VP8 ") return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L") {
      const bits = b.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length - 9) {
      if (b[i] !== 0xff) { i += 1; continue; }
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      }
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return null;
}

/* Fonts: self-hosted from Google Fonts at build time (cached), inlined as @font-face.
   If the download fails, pages fall back to a non-blocking Google Fonts link. */

const FONT_CSS = "https://fonts.googleapis.com/css2?family=Geist:wght@400;500&family=Geist+Mono:wght@400;500&family=Instrument+Serif:ital@1&display=swap";
const FONT_CACHE = join(tmpdir(), "huzaifa-site-fonts");
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const googleFontsHtml =
  `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />\n` +
  `  <link rel="preload" as="style" href="${FONT_CSS}" onload="this.onload=null;this.rel='stylesheet'" />\n` +
  `  <noscript><link rel="stylesheet" href="${FONT_CSS}" /></noscript>`;

async function cachedFetch(url, name, binary) {
  const file = join(FONT_CACHE, name);
  if (existsSync(file)) return binary ? readFileSync(file) : readFileSync(file, "utf8");
  const res = await fetch(url, { headers: { "user-agent": BROWSER_UA }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  const body = binary ? Buffer.from(await res.arrayBuffer()) : await res.text();
  mkdirSync(FONT_CACHE, { recursive: true });
  writeFileSync(file, body);
  return body;
}

async function selfHostFonts(outDir) {
  const css = await cachedFetch(FONT_CSS, "fonts.css", false);
  // Keep only the latin subset; the site has no other scripts.
  const faces = [...css.matchAll(/\/\* latin \*\/\s*(@font-face\s*{[^}]*})/g)].map((m) => m[1]);
  if (!faces.length) throw new Error("no latin @font-face rules in the Google Fonts CSS");
  mkdirSync(join(outDir, "assets", "fonts"), { recursive: true });
  const preload = new Set();
  const rules = [];
  for (const face of faces) {
    const url = face.match(/url\((https:[^)]+\.woff2)\)/)?.[1];
    if (!url) continue;
    const family = face.match(/font-family:\s*'([^']+)'/)[1].toLowerCase().replace(/\s+/g, "-");
    const name = `${family}-${basename(url).slice(0, 12)}.woff2`;
    writeFileSync(join(outDir, "assets", "fonts", name), await cachedFetch(url, name, true));
    rules.push(face.replace(url, `/assets/fonts/${name}`).replace(/\s+/g, " "));
    if (family === "geist") preload.add(name);
  }
  return [
    ...[...preload].map((name) => `<link rel="preload" href="/assets/fonts/${name}" as="font" type="font/woff2" crossorigin />`),
    `<style>${rules.join("\n")}</style>`,
  ].join("\n  ");
}

/* Helpers */

const ACTIVE = new Set(["building", "research"]);
const LINK_LABELS = { repo: "repository", demo: "live demo", paper: "paper", video: "video" };

const byOrder = (a, b) => (a.order ?? 999) - (b.order ?? 999) || (b.year ?? 0) - (a.year ?? 0);
const hasCaseStudy = (p) => present(p.summary);
const caseUrl = (p) => `/projects/${p.slug}/`;
const plural = (n, one, many) => (n === 1 ? one : many);
const initials = (name) => name.split(/\s+/).map((w) => w[0] || "").join("").toLowerCase();

const statusHtml = (p) => {
  const status = escapeHtml(p.status || "");
  const head = ACTIVE.has(p.status) ? `<span class="is-active">● ${status}</span>` : status;
  return [head, p.year ? escapeHtml(p.year) : "", p.role ? escapeHtml(p.role) : ""].filter(Boolean).join(" · ");
};

const externalLink = (label, href) =>
  `<a class="link" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(label)} ↗</a>`;

// Template placeholders ("TODO: …") must never reach the live site. Drafts are skipped
// before this runs; "_template" hint keys are ignored.
function findTodos(value, path, found = []) {
  if (typeof value === "string") {
    if (/\bTODO\b/.test(value)) found.push(path);
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => findTodos(item, `${path}[${i}]`, found));
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) if (key !== "_template") findTodos(item, `${path}.${key}`, found);
  }
  return found;
}

function checkTodos(sources) {
  const found = sources.flatMap(([file, items, name]) =>
    items.flatMap((item, i) => findTodos(item, `${file} → ${name(item, i)}`))
  );
  if (found.length) {
    throw new Error(
      `these fields still say TODO. Fill them in, empty them ("" or []), or set "draft": true:\n  ` + found.join("\n  ")
    );
  }
}

function checkProjects(projects) {
  const seen = new Set();
  for (const p of projects) {
    if (!p.slug || !p.title) throw new Error(`content/projects.json: every project needs a slug and a title (${JSON.stringify(p).slice(0, 80)}…)`);
    if (!/^[a-z0-9-]+$/.test(p.slug)) throw new Error(`content/projects.json: slug "${p.slug}" may only use a-z, 0-9 and -`);
    if (seen.has(p.slug)) throw new Error(`content/projects.json: duplicate slug "${p.slug}"`);
    seen.add(p.slug);
  }
}

/* Build */

export async function build({ outDir = join(root, "dist"), log = console.log } = {}) {
  const started = Date.now();
  const site = readJson("content/site.json", {});
  const allProjects = readJson("content/projects.json", []);
  const experience = readJson("content/experience.json", {});
  const now = readJson("content/now.json", []).filter((item) => !item.draft && present(item.title));
  const writing = readJson("content/writing.json", []).filter((item) => !item.draft && present(item.title));
  checkProjects(allProjects);

  const projects = allProjects.filter((p) => !p.draft).sort(byOrder);
  const caseStudies = projects.filter(hasCaseStudy);
  const roles = experience.roles || [];
  const experienceItems = [...roles, ...(experience.education || []), ...(experience.certifications || [])].filter((item) => present(item.title));
  checkTodos([
    ["content/site.json", [site], () => "site"],
    ["content/projects.json", projects, (p) => p.slug],
    ["content/now.json", now, (item, i) => item.title || `item ${i + 1}`],
    ["content/writing.json", writing, (item, i) => item.title || `item ${i + 1}`],
    ["content/experience.json", experienceItems, (item, i) => item.title || `item ${i + 1}`],
  ]);
  const resumes = (site.resumes || []).filter((r) => present(r.file));
  const resume = resumes.find((r) => r.primary) || resumes[0] || {};
  // Two or more résumés: "Resume ↗" opens a small chooser. One: a plain link.
  const resumeNavHtml = resumes.length > 1
    ? partial("resume-menu", {
        itemsHtml: resumes
          .map((r) => `<li><a class="resume-option" href="/${escapeHtml(r.file)}" target="_blank" rel="noreferrer"><span>${escapeHtml(r.for || r.label)}</span><span class="resume-meta">pdf ↗</span></a></li>`)
          .join("\n              "),
      })
    : resume.file
      ? `<a class="u nav-resume" href="/${escapeHtml(resume.file)}" target="_blank" rel="noreferrer">Resume ↗</a>`
      : "";
  const resumePaletteHtml = resumes
    .map((r, i) => `<li role="option" id="cmd-resume-${i + 1}" data-cmd="open" data-href="/${escapeHtml(r.file)}">open ${escapeHtml(resumes.length > 1 ? r.label : "résumé")} <span>pdf ↗</span></li>`)
    .join("\n        ");
  const year = new Date().getFullYear();

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  let fontsHtml;
  try {
    fontsHtml = await selfHostFonts(outDir);
  } catch (error) {
    log(`  fonts: ${error.message}; using the Google Fonts link instead`);
    fontsHtml = googleFontsHtml;
  }

  const layout = readText("templates/layout.html");
  const pages = [];

  const page = (path, main, meta) => {
    const canonical = site.url ? site.url.replace(/\/$/, "") + path : "";
    pages.push({ path, html: render(layout, { site, resume, year, main, fontsHtml, resumeNavHtml, resumePaletteHtml, page: { ...meta, canonical } }) });
  };

  /* Homepage */

  const shipped = projects.filter((p) => p.status === "shipped").length;
  const listed = projects.filter((p) => p.status !== "archived").length;
  const internships = roles.filter((r) => r.type === "internship").length;
  const years = projects.map((p) => p.year).filter(Number.isFinite);
  const since = years.length ? Math.min(...years) : null;

  const profile = site.profile || {};
  const currently = now[0] ? `${now[0].status ? now[0].status + " " : ""}${now[0].title}`.toLowerCase() : "";
  const based = site.location
    ? `<span class="js">"${escapeHtml(site.location)} · <time data-clock>--:--</time> ${escapeHtml(site.timezoneLabel || "")}"</span>`
    : "";
  const entries = [
    ["role", profile.role && `<span class="js">"${escapeHtml(profile.role)}"</span>`],
    ["based", based],
    ["focus", profile.focus && `<span class="js">"${escapeHtml(profile.focus)}"</span>`],
    ["currently", currently && `<span class="js">"${escapeHtml(currently)}"</span>`],
    ["projects", `<span class="jn">${listed}</span>`],
    ["open_to", profile.open_to && `<span class="js">"${escapeHtml(profile.open_to)}"</span>`],
  ].filter(([, value]) => value);
  const profileHtml = [
    `<span class="jl"><span class="jp">{</span></span>`,
    ...entries.map(([key, value], i) =>
      `<span class="jl j1">  <span class="jk">"${key}"</span><span class="jp">: </span>${value}<span class="jp">${i < entries.length - 1 ? "," : ""}</span></span>`
    ),
    `<span class="jl"><span class="jp">}</span><span class="cursor" aria-hidden="true"></span></span>`,
  ].join("");

  const photoPath = site.photo && existsSync(join(root, site.photo)) ? site.photo : "";
  let photoHtml;
  if (photoPath) {
    const size = imageSize(join(root, photoPath)) || { width: 300, height: 300 };
    photoHtml = `<img class="portrait" src="/${escapeHtml(photoPath)}" alt="${escapeHtml(site.photoAlt || site.name)}" width="${size.width}" height="${size.height}" decoding="async" />`;
  } else {
    // No photo: the serif monogram is the intended default.
    if (site.photo) log(`  warning: photo ${site.photo} not found, showing the monogram`);
    photoHtml = `<div class="portrait portrait-fallback" role="img" aria-label="${escapeHtml(site.photoAlt || site.name)}"><span aria-hidden="true">${escapeHtml(initials(site.name || ""))}</span></div>`;
  }

  const stats = [
    shipped && { value: shipped, label: plural(shipped, "project shipped", "projects shipped") },
    internships && { value: internships, label: plural(internships, "internship", "internships") },
    since && { value: since, label: "building since" },
  ].filter(Boolean);

  const cards = projects.filter((p) => p.status !== "archived");
  const archive = projects.filter((p) => p.status === "archived");

  const cardsHtml = cards
    .map((p) => {
      const caseStudy = hasCaseStudy(p);
      const soon = !caseStudy && ACTIVE.has(p.status);
      const repo = p.links?.repo || p.links?.demo || "";
      const href = caseStudy ? caseUrl(p) : soon ? "" : repo;
      const ctaHtml = caseStudy ? 'case study <span class="arrow">↗</span>' : soon ? "case study soon" : repo ? 'code <span class="arrow">↗</span>' : "";
      return partial("card", {
        p, href, noHref: !href, external: href && !caseStudy, soon,
        metaHtml: statusHtml(p), stack: (p.stack || []).join(" · "), ctaHtml,
      });
    })
    .join("\n");

  const archiveHtml = archive
    .map((p) => {
      const caseStudy = hasCaseStudy(p);
      const href = caseStudy ? caseUrl(p) : p.links?.repo || p.links?.demo || "";
      if (!href) return "";
      return partial("archive-row", {
        p, href, external: !caseStudy, year: p.year || "", stack: (p.stack || []).join(" · "), cta: caseStudy ? "case study" : "code",
      });
    })
    .join("\n");

  const nowHtml = now.map((item) => partial("now-row", { item, noLink: !item.link })).join("\n");
  const writingHtml = writing.map((item) => partial("writing-row", { item, noLink: !item.link })).join("\n");
  const experienceHtml = experienceItems.map((item) => partial("experience-row", { item })).join("\n");
  const stackHtml = (site.stack || [])
    .filter((col) => present(col.items))
    .map((col) => partial("stack-column", { col, itemsHtml: col.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("") }))
    .join("\n");

  const sections = { about: true, work: !!cardsHtml, now: !!nowHtml, writing: !!writingHtml, stack: !!stackHtml, experience: !!experienceHtml, contact: true };
  const n = {};
  Object.keys(sections).filter((key) => sections[key]).forEach((key, i) => { n[key] = String(i + 1).padStart(2, "0"); });

  const contactLinksHtml = [
    ...(site.social || []).filter((s) => s.url).map((s) => externalLink(s.label, s.url)),
    ...(resumes.length > 1
      ? resumes.map((r) => externalLink(r.label, "/" + r.file))
      : resume.file ? [externalLink("Résumé", "/" + resume.file)] : []),
  ].filter(Boolean).join("\n          ");

  const home = render(readText("templates/index.html"), {
    site, n, profileHtml, photoHtml,
    aboutHtml: (site.about?.paragraphs || []).filter(present).map((t) => `<p>${escapeHtml(t)}</p>`).join("\n          "),
    statsHtml: stats.map((s) => partial("stat", s)).join(""),
    cardsHtml, archiveHtml: archiveHtml.trim(), archiveCount: archive.length,
    nowHtml, writingHtml, stackHtml, experienceHtml,
    resumesHtml: resumes.map((r) => externalLink(r.label, "/" + r.file)).join("\n            "),
    contactLinksHtml,
  });
  page("/", home, { title: site.title || site.name, description: site.description || "", ogType: "website", scripts: "" });

  /* Case-study pages */

  const projectTemplate = readText("templates/project.html");
  caseStudies.forEach((p, i) => {
    const flow = (p.flow || []).filter((node) => present(node.node));
    const sim = (p.simulation || []).filter((s) => Number.isInteger(s.at) && s.at < flow.length);
    let flowHtml = "";
    if (flow.length) {
      const nodesHtml = flow
        .map((node, index) => {
          const steps = sim.filter((s) => s.at === index);
          const final = [...steps].reverse();
          const state = final.find((s) => s.state)?.state;
          const status = final.find((s) => s.status)?.status;
          return `<li${state ? ` data-state="${escapeHtml(state)}"` : ""}><span class="node">${escapeHtml(node.node)}</span><span class="note" data-default="${escapeHtml(node.note || "")}">${escapeHtml(status || node.note || "")}</span></li>`;
        })
        .join("");
      const logs = sim.filter((s) => s.log);
      flowHtml = partial("flow", {
        file: p.flowFile || "flow.md", slug: p.slug, nodesHtml,
        simJson: JSON.stringify(sim.map(({ at, status, short, state, log: line }) => ({ at, status, short, state, log: line }))),
        log: logs.length ? logs[logs.length - 1].log : "",
        caption: `${p.title} flow: ${flow.map((node) => node.node).join(" → ")}.`,
      });
    }

    const pdtHtml = [["problem", p.problem], ["decision", p.decision], ["trade-off", p.tradeoff]]
      .filter(([, text]) => present(text))
      .map(([label, text]) => `<div><p class="label label-accent">${label}</p><p>${escapeHtml(text)}</p></div>`)
      .join("");

    const codeHtml = p.code && present(p.code.snippet)
      ? partial("code", {
          file: p.code.file || "snippet", lang: p.code.lang || "", label: `${p.title} code, from ${p.code.path || p.code.file || "the repository"}`,
          linesHtml: codeLines(p.code.snippet, p.code.lang),
        })
      : "";

    const imagesHtml = (p.images || [])
      .filter((img) => present(img.src))
      .map((img) => {
        const file = join(root, img.src);
        if (!existsSync(file)) {
          log(`  warning: ${p.slug}: image ${img.src} not found, skipped`);
          return "";
        }
        const size = imageSize(file) || {};
        return partial("image", { img, file: basename(img.src), slug: p.slug, width: size.width, height: size.height });
      })
      .join("\n");

    const resultsHtml = (p.results || [])
      .filter((r) => present(r.value) && present(r.label))
      .map((r) => partial("stat", r))
      .join("");

    const buttonsHtml = Object.entries(LINK_LABELS)
      .filter(([key]) => present(p.links?.[key]))
      .map(([key, label], index) =>
        `<a class="button ${index === 0 ? "button-primary" : "button-secondary"}" href="${escapeHtml(p.links[key])}" target="_blank" rel="noreferrer">${label} ↗</a>`
      )
      .join("\n            ");

    let pagerHtml = "";
    if (caseStudies.length > 1) {
      const prev = caseStudies[(i - 1 + caseStudies.length) % caseStudies.length];
      const next = caseStudies[(i + 1) % caseStudies.length];
      pagerHtml =
        `<a class="pager-link" href="${caseUrl(prev)}"><span class="label">← previous project</span><span class="pager-title">${escapeHtml(prev.title)}</span></a>\n        ` +
        `<a class="pager-link is-next" href="${caseUrl(next)}"><span class="label">next project →</span><span class="pager-title">${escapeHtml(next.title)}</span></a>`;
    }

    const main = render(projectTemplate, {
      p, metaHtml: statusHtml(p), buttonsHtml, flowHtml, pdtHtml, codeHtml, imagesHtml: imagesHtml.trim(), resultsHtml, pagerHtml,
    });
    const description = p.oneLiner || p.summary;
    page(caseUrl(p), main, {
      title: `${p.title} · ${site.name}`,
      description,
      ogType: "article",
      scripts: flowHtml ? '<script src="/flow.js"></script>' : "",
    });
  });

  /* Write */

  for (const { path, html } of pages) {
    const dir = join(outDir, path);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), html.replace(/\n\s*\n(\s*\n)+/g, "\n\n"));
  }
  if (existsSync(join(root, "assets"))) cpSync(join(root, "assets"), join(outDir, "assets"), { recursive: true });
  for (const file of ["styles.css", "script.js", "flow.js"]) cpSync(join(root, file), join(outDir, file));
  if (site.url) {
    const base = site.url.replace(/\/$/, "");
    const urls = pages.map((pg) => `  <url><loc>${escapeHtml(base + pg.path)}</loc></url>`).join("\n");
    writeFileSync(join(outDir, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
  }

  const drafts = allProjects.filter((p) => p.draft).map((p) => p.slug);
  log(`built ${pages.length} pages in ${Date.now() - started}ms → ${outDir}` + (drafts.length ? ` (skipped drafts: ${drafts.join(", ")})` : ""));
  return pages;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outFlag = process.argv.indexOf("--out");
  const outDir = outFlag > -1 ? resolve(process.argv[outFlag + 1]) : join(root, "dist");
  build({ outDir }).catch((error) => {
    console.error(`build failed: ${error.message}`);
    process.exit(1);
  });
}
