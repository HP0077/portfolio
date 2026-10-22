# Editing the site

Everything you'd want to change lives in `content/`. You never need to touch `templates/`, `styles.css` or `script.js` to add a project, paper, job or "now" item.

```
content/site.json        name, hero text, about, contact, links, résumés, stack
content/projects.json    projects (homepage cards + one case-study page each)
content/experience.json  jobs, education, certifications
content/now.json         1–3 "currently" items
content/writing.json     papers, posts, talks (empty for now)
assets/                  résumés, your photo, project images
```

After any change:

```
npm run dev     # builds, serves on http://localhost:3000, rebuilds when content/ or templates/ change
npm run build   # one-off build into dist/ (Vercel runs this on deploy)
```

Restart `npm run dev` if you edit `scripts/build.mjs` itself.

## Adding something on your own (copy, paste, fill in)

Ready-made blocks live in `content/templates/`. Every placeholder starts with `TODO:`.

| To add… | Copy from | Paste into |
|---|---|---|
| a project (card only) | `templates/project.json`, the first block ("SHORT") | `content/projects.json` |
| a project with a case-study page | `templates/project.json`, the second block ("FULL") | `content/projects.json` |
| a "now" item | `templates/now.json` | `content/now.json` |
| a paper, post or talk | `templates/writing.json` | `content/writing.json` |
| a job, degree or certificate | `templates/experience.json` (pick one block) | the matching list in `content/experience.json` |

Step by step, for a project:

1. Open `content/templates/project.json` and copy one block, from its opening `{` to its matching `}`.
2. Open `content/projects.json`. Put a comma after the last `}` in the list, then paste your block before the final `]`.
3. Change `slug` to a short URL name (lowercase, letters, numbers and `-`, e.g. `mixshield`). It must be different from every other project.
4. Replace every `TODO: …` with your own text. For anything you don't have, use `""` for text or `[]` for lists, and it won't be shown.
5. If you have screenshots, put them in `assets/projects/<slug>/` and point `images` at them. Otherwise set `"images": []`.
6. Pick `order`: `1` shows first on the homepage. Change other projects' numbers if needed.
7. When it's ready, change `"draft": true` to `"draft": false`.
8. Run `npm run build` (or keep `npm run dev` running and refresh).

**Safety net:** if anything you publish still contains `TODO`, the build stops and lists exactly which file and field to fix, so half-finished text can't reach the live site. Drafts can keep `TODO`s as long as you like. The `_template` line in each block is just a hint; you can delete it or leave it.

**If the build says "not valid JSON":** you're usually missing a comma between two `}` `{` blocks, or have an extra comma after the last item in a list. The error message gives the position.

Rules that keep the site honest:

- **Empty fields aren't shown.** Leave a field as `""`, `[]` or `null` and it disappears: no "undefined", no empty boxes. Empty `now.json` or `writing.json` hides that whole section.
- **Numbers are computed.** "Projects shipped", "internships" and "building since" are counted from the JSON. Don't type them anywhere.
- **`results` only takes real, checkable numbers** (a benchmark, a user count, a score you can point to).
- **Code snippets are copied verbatim** from the real repository. Don't tidy them.
- **No grades or marks** anywhere on the site.

---

## Add a new project

1. Open `content/projects.json` and copy an existing entry (or use the MixShield template below).
2. Fill in the fields. Only `slug` and `title` are required; see the field list below.
3. Put images in `assets/projects/<slug>/` (WebP or AVIF, at least 1600px wide) and list them in `images`. The build reads their width and height for you.
4. Set `order` to place it (see "Change the order").
5. Keep `"draft": true` while you're still writing it, so the build skips it. Remove it, or set it to `false`, when it's ready.
6. Run `npm run build` (or watch `npm run dev`).

What you get, automatically:

- A card in the Work grid. With an odd number of cards, the last one spans both columns.
- A case-study page at `/projects/<slug>/`, as long as `summary` is filled in.
- Updated hero JSON (`projects` counts every published, non-archived project) and About stats ("projects shipped" counts `status: "shipped"`).
- Previous / next links on every case-study page.

### Project fields

| Field | Required | What it does |
|---|---|---|
| `slug` | yes | URL name: lowercase letters, numbers, `-` (e.g. `mixshield`) |
| `title` | yes | Project name |
| `draft` | no | `true` skips the project entirely |
| `kicker` | no | Short mono line above the title ("ai event orchestration") |
| `year` | no | Shown on the card; the earliest year becomes "building since" |
| `status` | no | `"shipped"`, `"building"`, `"research"` or `"archived"`. Shipped projects are counted in the stats. Building and research get the lime ● dot. Archived projects move into "earlier work". |
| `order` | no | Sort position: lower comes first. Ties go to the newest year. |
| `role` | no | Shown after status · year on the case-study page ("solo", "team of 4 · backend") |
| `oneLiner` | no | One sentence on the card and under the case-study title |
| `summary` | no | 2–3 sentences. **A case-study page is only built when this is filled.** |
| `problem`, `decision`, `tradeoff` | no | The three columns on the case-study page |
| `stack` | no | List of lowercase tools, shown in mono |
| `links.repo`, `links.demo`, `links.paper`, `links.video` | no | Buttons on the case-study page; the repo also links "earlier work" rows |
| `flowFile` | no | Tab name of the flow window ("request_flow.md") |
| `flow` | no | Nodes for the animated flow window: `[{ "node": "django api", "note": "drf · jwt" }]`, up to 8 |
| `simulation` | no | Steps the dot plays at each node: `{ "at": 2, "status": "groq · 429 rate limited", "short": "groq · 429", "state": "fail", "log": "> provider_failed groq" }`. `at` is the node index (from 0). `state` is `"ok"` or `"fail"`. `short` is the status shown on phones. Every key except `at` is optional. Never put made-up latencies here. |
| `code` | no | `{ "file": "views.py", "path": "backend/…/views.py", "lang": "python", "snippet": "…" }`. Python gets syntax colouring; other languages are shown plain. |
| `images` | no | `[{ "src": "assets/projects/<slug>/1.webp", "alt": "what the screen shows" }]` |
| `results` | no | `[{ "value": "120 ms", "label": "p95 latency" }]`, real numbers only |

### Template for MixShield (already in `projects.json` as a draft)

When MixShield is ready:

1. In `content/projects.json`, find the `mixshield` entry and set `"draft": false`.
2. Fill in `year`, `oneLiner` and `summary` (the summary turns on the case-study page), then `problem`, `decision`, `tradeoff`, `stack` and `links.repo` / `links.demo`.
3. Optional: add `flow` + `simulation` to animate how a request moves through it, a verbatim `code` snippet, and images in `assets/projects/mixshield/`.
4. Leave `status` as `"building"` while you're still working on it. Change it to `"shipped"` once it's done, and the shipped count goes up by itself.
5. If you want it in the hero's `"currently"` line, put it first in `content/now.json` (see below).
6. Run `npm run build` and check `/` and `/projects/mixshield/`.

```json
{
  "draft": true,
  "slug": "mixshield",
  "title": "MixShield",
  "kicker": "prompt-injection guardrails for tool-using agents",
  "year": null,
  "status": "building",
  "order": 5,
  "role": "",
  "oneLiner": "",
  "summary": "",
  "problem": "",
  "decision": "",
  "tradeoff": "",
  "stack": [],
  "links": { "repo": "", "demo": "", "paper": "", "video": "" },
  "flowFile": "",
  "flow": [],
  "simulation": [],
  "code": null,
  "images": [],
  "results": []
}
```

## Change the order projects appear in

Edit `order` on each project: `1` comes first, then `2`, and so on. Projects with the same `order` go newest `year` first. The case-study previous / next links follow the same order. To retire a project from the grid without deleting it, set `"status": "archived"`. It moves into the collapsed "earlier work" list.

## Add a paper, post or talk

Add an object to `content/writing.json`. The Writing section appears as soon as the list isn't empty.

```json
[
  {
    "title": "Guardrails for tool-using agents",
    "venue": "Workshop name or blog",
    "year": 2026,
    "status": "in review",
    "link": ""
  }
]
```

`status` is free text, usually `"published"`, `"in review"` or `"in progress"`. `link` is optional. Add `"draft": true` to hide an entry.

## Add a "now" item

Edit `content/now.json`: keep 1–3 items, most important first. **The first item is also the `"currently"` line in the hero JSON.**

```json
{ "status": "building", "title": "MixShield", "line": "One sentence on what you're doing.", "link": "/projects/mixshield/", "dates": "since 2026" }
```

`status` is shown as "● building" (any word works: building, writing, learning). `link` and `dates` are optional. An empty list hides the section.

## Add a job, degree or certificate

Edit `content/experience.json`. Each entry has `date`, `title`, `org` and `line` (all text; `line` is optional). Put jobs in `roles`, degrees in `education` and certificates in `certifications`. They show in that order. Add `"type": "internship"` to internships so the About stats count them.

```json
{ "type": "internship", "date": "jun 2026 – aug 2026", "title": "Backend Intern", "org": "Company", "line": "One sentence on what you shipped." }
```

## Everything else (`content/site.json`)

- `headline`, `lede`, `status`: the hero. `status` is the lime line above the headline.
- `profile`: the values in the hero `huzaifa.json` window. `projects` and `currently` are filled in for you.
- `about.paragraphs`: a list of paragraphs. `about.outsideCode`: one line about you outside code (empty = hidden).
- `photo`: leave it `""` to show the "hp" monogram (the current choice). To use a photo instead, drop a square image (600×600 or larger) in `assets/`, e.g. `assets/me.jpg`, and set `"photo": "assets/me.jpg"`.
- `stack`: the daily / comfortable / learning columns.
- `social`, `email`: contact links.
- `resumes`: each entry is `{ "label": "AI résumé", "for": "AI / ML roles", "file": "assets/your.pdf" }`. With two or more, the header "Resume ↗" opens a small menu listing them by their `for` text, Contact shows one link per résumé, and Ctrl+K gets "open AI résumé" and so on. With one, "Resume ↗" is a plain link. To add or swap a résumé, drop the PDF in `assets/` and edit this list.
- `url`: set this to the live address (e.g. `https://huzaifa.dev`) to add canonical URLs, `og:url` and a `sitemap.xml`.
