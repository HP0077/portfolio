// npm run dev: build, serve dist/ on localhost, rebuild when content or templates change.
// Usage: node scripts/dev.mjs [--out <dir>] [--port <n>]
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync, watch } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";
import { build, root } from "./build.mjs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const outDir = resolve(arg("--out", join(root, "dist")));
const port = Number(arg("--port", process.env.PORT || 3000));

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".avif": "image/avif", ".gif": "image/gif", ".pdf": "application/pdf", ".xml": "application/xml",
  ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
};

const safeBuild = () => build({ outDir }).catch((error) => console.error(`build failed: ${error.message}`));

await safeBuild();

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  let file = normalize(join(outDir, path));
  if (file !== outDir && !file.startsWith(outDir + sep)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end(`404: ${path}`);
    return;
  }
  const type = TYPES[extname(file).toLowerCase()] || "application/octet-stream";
  const headers = { "content-type": type, "cache-control": "no-store" };
  let body = readFileSync(file);
  // Compress text like Vercel does, so local Lighthouse runs are representative.
  if (/text|javascript|json|svg|xml/.test(type) && /\bgzip\b/.test(req.headers["accept-encoding"] || "")) {
    body = gzipSync(body);
    headers["content-encoding"] = "gzip";
  }
  res.writeHead(200, headers).end(body);
}).listen(port, () => console.log(`serving ${outDir} at http://localhost:${port}`));

let timer;
const rebuild = (what) => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    console.log(`changed: ${what}`);
    safeBuild();
  }, 120);
};

for (const dir of ["content", "templates", "assets"]) {
  if (existsSync(join(root, dir))) watch(join(root, dir), { recursive: true }, (_, name) => rebuild(`${dir}/${name}`));
}
for (const file of ["styles.css", "script.js", "flow.js"]) {
  watch(join(root, file), () => rebuild(file));
}
