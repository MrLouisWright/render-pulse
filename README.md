# render-pulse

> Find the CSS and JavaScript that block first paint in your built site, with the defer, async, media or critical-CSS fix for each.

Nothing is painted until the browser has downloaded and parsed every render-blocking stylesheet and synchronous script in `<head>`. One forgotten `<script src>` without `defer`, a 200 kB framework stylesheet or an `@import` chain can add seconds to First Contentful Paint and LCP on mobile. `render-pulse` reads your static build output, works out which resources are actually on the critical path (respecting `defer`, `async`, `type=module`, `media`, `disabled` and alternate stylesheets) and reports each one with a concrete fix.

CLI, library and GitHub Action. Node.js 18+, **zero runtime dependencies**. Works on any static build output (Astro, Next.js `output: 'export'`, Eleventy, Hugo, Jekyll, Docusaurus, VitePress, plain HTML) and runs offline: point it at the folder your build writes. By Louis Wright.

## Features

- **Scripts:** classic `<script src>` in `<head>` without `defer`/`async` (high), synchronous external scripts in the middle of `<body>`, `document.write()`, scripts placed before stylesheets.
- **Stylesheets:** gzip size of all render-blocking CSS per page against a budget (default 50 kB), too many blocking stylesheets, `@import` in CSS files or inline styles, print stylesheets without `media="print"`, and a hint to inline critical CSS when blocking CSS exceeds the 14 kB first round trip.
- **Third parties:** render-blocking resources from other origins without `<link rel="preconnect">`.
- **Knows the async patterns:** `media="print" onload="this.media='all'"`, module scripts, JSON-LD and template scripts are not reported.

### Scope

render-pulse inspects the HTML and CSS on disk; it does not run a browser. Font loading has its own tool (font-pulse), JavaScript size is bundle-pulse, and lab timings are vitals-pulse.

## Rules

| Rule | Default severity | What it means |
|---|---|---|
| `render-blocking-script` | high | Classic <script src> in <head> without defer or async blocks rendering |
| `render-blocking-css-heavy` | medium | Render-blocking CSS is large (inline the critical CSS, load the rest later) |
| `render-css-import` | medium | @import in render-blocking CSS serialises downloads |
| `render-third-party-blocking` | medium | Render-blocking resource from another origin without preconnect |
| `render-document-write` | medium | document.write() in a script delays parsing and can block on network |
| `render-parser-blocking-body` | low | Synchronous external <script> in <body> blocks parsing of everything after it |
| `render-too-many-stylesheets` | low | Many render-blocking stylesheets |
| `render-print-css-blocking` | low | Print/alternate stylesheet without a matching media attribute blocks rendering |
| `render-large-inline` | low | Very large inline <style> or <script> in <head> |
| `render-sync-before-css` | low | Synchronous script placed before stylesheets delays CSS discovery |
| `render-no-critical-css` | info | Blocking CSS over 14 KB and no inline critical CSS |
| `allowlist-expired` | medium | An allowlist entry is past its `expires` date |
| `allowlist-unused` | info | An allowlist entry matched nothing |

## Install and run

```bash
npx render-pulse dist
npx render-pulse public --max-css-kb 30 --fail-on medium
npx render-pulse _site --format sarif > render.sarif
```

Pages are mapped to URLs the way static hosts serve them: `index.html` → `/`, `blog/index.html` → `/blog/`, `about.html` → `/about.html` (or `/about` with `--clean-urls`). Pass `--base-url` with your public URL, or let it be inferred from canonical / `og:url` tags. Meta-refresh redirect stubs and `404.html` are skipped. `X-Robots-Tag` and `Link` headers are read from Netlify/Cloudflare `_headers` and `vercel.json`.

### Sample output

```text
render-pulse — https://example.com
1 page(s) at https://example.com

HIGH     index.html:2 /: <script src="/js/jquery.js"> (0.0 KB gzip) in <head> blocks rendering [render-blocking-script]
HIGH     index.html:7 /: <script src="https://tags.example.org/t.js"> in <head> blocks rendering [render-blocking-script]
MEDIUM   css/all.css css/all.css uses @import [render-css-import]
MEDIUM   index.html /: render-blocking resource from https://fonts.example.org without <link rel="preconnect"> [render-third-party-blocking]
MEDIUM   index.html /: render-blocking resource from https://tags.example.org without <link rel="preconnect"> [render-third-party-blocking]
MEDIUM   index.html /: 56.2 KB gzip (195.4 KB raw) of render-blocking CSS (budget 50.0 KB) [render-blocking-css-heavy]
```

## Options

```text
render-pulse 1.0.0 — find render-blocking CSS and JS in your built site

Usage: render-pulse [site-dir] [options]

Site
      --base-url <url>        Public URL of the site, e.g. https://example.com (default: inferred from canonical/og:url)
      --include <globs>       Only check these pages (file or URL path globs, comma-separated)
      --exclude <globs>       Skip these pages
      --clean-urls            Pages are served without .html (about.html -> /about)
Render
      --max-css-kb <n>         Render-blocking CSS budget per page, gzip KB (default 50)

Common
  -c, --config <file>     JSON config (default: .render-pulse.json or "renderPulse" in package.json)
  -f, --format <fmt>      text (default) | json | sarif | markdown
      --json <file>       Also write a JSON report
      --sarif <file>      Also write SARIF 2.1.0
      --markdown <file>   Also write Markdown (e.g. for a job summary)
      --fail-on <sev>     critical | high | medium | low | info | none (default: high)
      --list-rules        Print rules and default severities
      --no-fixes          Hide fix suggestions in text output
      --no-color          Disable colours
  -v, --version / -h, --help

Exit codes: 0 = passed, 1 = findings at or above --fail-on, 2 = usage, config or read error.
```

## Configuration and allowlist

Options can live in `.render-pulse.json` (or a `"renderPulse"` key in `package.json`, or `--config <file>`):

```json
{
  "failOn": "medium",
  "severity": {
    "render-blocking-script": "low"
  },
  "allowlist": [
    {
      "rule": "render-blocking-script",
      "subject": "/js/consent-loader.js",
      "reason": "Consent manager must run before other tags",
      "expires": "2027-03-31"
    }
  ],
  "maxCss": 40960,
  "maxStylesheets": 2,
  "maxInline": 30720,
  "exclude": [
    "/legacy/**"
  ]
}
```

- **`severity`** changes a rule's severity, or turns it `"off"`.
- **`allowlist`** entries suppress matching findings. Each needs a `reason` and matches on any combination of `rule`, `file`, `subject` (globs with `*`) and `match` (a substring of the message). Add `expires` (`YYYY-MM-DD`) so the exception is time-boxed: once it lapses the finding comes back along with an `allowlist-expired` finding (medium). Entries that no longer match anything are reported as `allowlist-unused` (info).

Config can also set `baseUrl`, `include`, `exclude` and `cleanUrls`. The config file is looked up in the site directory first, then in the current directory, so `.render-pulse.json` can live at your repository root. Other keys: `maxCss` (bytes gzip), `maxStylesheets` (default 3), `maxInline` (default 50 kB), plus `baseUrl`, `include`, `exclude` and `cleanUrls`.

## Output and exit codes

- `--format text` (default), `json`, `sarif` (SARIF 2.1.0 for GitHub code scanning) or `markdown` (for job summaries and PR comments). `--json`, `--sarif` and `--markdown` write extra report files in the same run.
- `--fail-on <severity>` sets the threshold (`critical`, `high`, `medium`, `low`, `info`, `none`; default `high`).
- Exit codes: **0** passed, **1** findings at or above `--fail-on`, **2** usage, config or read error.

## GitHub Action

```yaml
permissions:
  contents: read
  security-events: write   # only needed for the SARIF upload
jobs:
  render-pulse:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
        with: { persist-credentials: false }
      - run: npm ci && npm run build   # produce the static site first
      - uses: MrLouisWright/render-pulse@v1
        with:
          path: dist
          fail-on: high
          sarif: render-pulse.sarif
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with: { sarif_file: render-pulse.sarif }
```

| Input | Description | Default |
|---|---|---|
| `path` | Built site directory (e.g. dist, public, _site) | `.` |
| `base-url` | Public URL of the site, e.g. https://example.com | |
| `fail-on` | Failure threshold | `high` |
| `config` | Config file path | |
| `sarif` / `json` | Write SARIF / JSON report to this path | |
| `job-summary` | Add the Markdown report to the job summary | `true` |
| `args` | Extra CLI arguments | |

The action runs the bundled CLI with Node 20; it has no dependencies to install. Pin it to a commit SHA if your policy requires it.

## Library

```js
import { check, blocksRender } from "render-pulse";
blocksRender({ rel: "stylesheet", media: "print" }); // false
const report = check("dist", { maxCss: 30 * 1024 });
```

Types are included.

## Requirements

Node.js 18 or newer. Zero runtime dependencies.

## Support

If this project is useful to you, you can support its development with a donation: [Buy me a coffee](https://donate.stripe.com/aFa00lek3cvX4Ds2Fk9EI0b). It helps keep these tools maintained, documented and free for everyone.

## Licence

MIT © Louis Wright ([Louis Wright](https://github.com/MrLouisWright))
