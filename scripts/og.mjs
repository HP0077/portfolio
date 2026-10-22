// npm run og: renders the 1200×630 social preview cards (assets/og/site.png and
// assets/og/<slug>.png) with the Chrome installed on this computer. Zero npm
// dependencies: Chrome's own --screenshot flag does the drawing.
// Usage: node scripts/og.mjs [--out <dir>]   Set CHROME_PATH if Chrome isn't found.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build, escapeHtml, render, root } from "./build.mjs";

const outFlag = process.argv.indexOf("--out");
const outDir = outFlag > -1 ? resolve(process.argv[outFlag + 1]) : join(root, "assets", "og");

const CHROME_PATHS = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);
const chrome = CHROME_PATHS.find((p) => existsSync(p));
if (!chrome) {
  console.error("og: Chrome or Edge not found. Set CHROME_PATH to its executable.");
  process.exit(1);
}

const json = (file, fallback) => (existsSync(join(root, file)) ? JSON.parse(readFileSync(join(root, file), "utf8")) : fallback);
const site = json("content/site.json", {});
const now = json("content/now.json", []).filter((item) => !item.draft && item.title);
const projects = json("content/projects.json", []).filter((p) => !p.draft);
const host = (site.url || "").replace(/^https?:\/\//, "").replace(/\/$/, "");

// Build once into a temp folder to get the self-hosted font files.
const work = mkdtempSync(join(tmpdir(), "og-"));
await build({ outDir: join(work, "site"), log: () => {} });
const fontDir = join(work, "site", "assets", "fonts");
const fonts = existsSync(fontDir) ? readdirSync(fontDir) : [];
const files = {
  sans: fonts.find((f) => f.startsWith("geist-") && !f.startsWith("geist-mono-")),
  mono: fonts.find((f) => f.startsWith("geist-mono-")),
  serif: fonts.find((f) => f.startsWith("instrument-serif-")),
};
const face = (family, file, style, weight) =>
  file ? `@font-face { font-family: "${family}"; font-style: ${style}; font-weight: ${weight}; src: url("${pathToFileURL(join(fontDir, file)).href}") format("woff2"); }` : "";
const fontsCss = [
  face("Geist", files.sans, "normal", "400 500"),
  face("Geist Mono", files.mono, "normal", "400 500"),
  face("Instrument Serif", files.serif, "italic", "400"),
].join("\n");
if (!fonts.length) console.warn("og: fonts could not be downloaded; cards will use fallback fonts.");

const template = readFileSync(join(root, "templates", "og.html"), "utf8");
const str = (text) => `<span class="js">"${escapeHtml(text)}"</span>`;

function profileJson() {
  const shippable = projects.filter((p) => p.status !== "archived").length;
  const currently = now[0] ? `${now[0].status ? now[0].status + " " : ""}${now[0].title}`.toLowerCase() : "";
  const profile = site.profile || {};
  const rows = [
    ["role", profile.role && str(profile.role)],
    ["based", site.location && str(`${site.location} · ${site.timezoneLabel || ""}`.trim())],
    ["focus", profile.focus && str(profile.focus)],
    ["currently", currently && str(currently)],
    ["projects", `<span>${shippable}</span>`],
    ["open_to", profile.open_to && str(profile.open_to)],
  ].filter(([, value]) => value);
  return `<div class="json"><span class="jl"><span class="jp">{</span></span>${rows
    .map(([key, value], i) => `<span class="jl j1">  <span class="jk">"${key}"</span><span class="jp">: </span>${value}<span class="jp">${i < rows.length - 1 ? "," : ""}</span></span>`)
    .join("")}<span class="jl"><span class="jp">}</span><span class="cursor"></span></span></div>`;
}

function flowNodes(p) {
  const flow = (p.flow || []).slice(0, 6);
  if (!flow.length) {
    return `<ul class="stack">${(p.stack || []).slice(0, 6).map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul>`;
  }
  const sim = p.simulation || [];
  return `<div class="nodes">${flow
    .map((node, i) => {
      const steps = sim.filter((s) => s.at === i).reverse();
      const state = steps.find((s) => s.state)?.state || "";
      const note = steps.find((s) => s.status)?.status || node.note || "";
      return `<div class="node ${escapeHtml(state)}"><span>${escapeHtml(node.node)}</span><span>${escapeHtml(note)}</span></div>`;
    })
    .join("")}</div>`;
}

const h = site.headline || {};
const cards = [
  {
    name: "site",
    ctx: {
      label: site.status ? `● ${site.status}` : "",
      titleHtml: `<h1><span class="line">${escapeHtml(h.first || site.name)}</span><span class="line dim">${escapeHtml(h.before || "")} <em>${escapeHtml(h.accent || "")}</em>${escapeHtml(h.after || "")}</span></h1>`,
      url: host,
      tab: site.profile?.file || "profile.json",
      meta: "profile",
      bodyHtml: profileJson(),
    },
  },
  ...projects
    .filter((p) => p.summary)
    .map((p) => ({
      name: p.slug,
      ctx: {
        label: `case study${p.kicker ? " · " + p.kicker : ""}`,
        titleHtml: `<h1 class="project">${escapeHtml(p.title)}</h1>`,
        sub: p.oneLiner,
        url: host ? `${host}/projects/${p.slug}/` : "",
        tab: p.flow?.length ? p.flowFile || "flow.md" : "stack.txt",
        meta: p.slug,
        bodyHtml: flowNodes(p),
      },
    })),
];

mkdirSync(outDir, { recursive: true });
for (const card of cards) {
  const html = render(template, { name: site.name, roles: site.roles, fontsCss, ...card.ctx });
  const htmlFile = join(work, `${card.name}.html`);
  const png = join(outDir, `${card.name}.png`);
  writeFileSync(htmlFile, html);
  execFileSync(chrome, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
    "--window-size=1200,630", "--virtual-time-budget=4000", `--screenshot=${png}`, pathToFileURL(htmlFile).href,
  ], { stdio: "ignore" });
  const head = readFileSync(png);
  console.log(`og: ${card.name}.png  ${head.readUInt32BE(16)}×${head.readUInt32BE(20)}`);
}
rmSync(work, { recursive: true, force: true });
console.log(`og: ${cards.length} cards → ${outDir}`);
