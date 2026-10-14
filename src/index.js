// render-pulse: find render-blocking CSS and JS in the critical path of a built static site and suggest
// defer/async/media/critical-CSS fixes. Zero dependencies. Louis Wright, MIT.
import { gzipSync } from 'node:zlib';
import { runBeacon, finder } from './site.js';
import { buildReport, UsageError } from './core.js';

export * from './core.js';
export { loadSite, parseHtml, SITE_OPTIONS, SITE_HELP } from './site.js';

export const RULES = {
  'render-blocking-script': { severity: 'high', title: 'Classic <script src> in <head> without defer or async blocks rendering' },
  'render-blocking-css-heavy': { severity: 'medium', title: 'Render-blocking CSS is large (inline the critical CSS, load the rest later)' },
  'render-css-import': { severity: 'medium', title: '@import in render-blocking CSS serialises downloads' },
  'render-third-party-blocking': { severity: 'medium', title: 'Render-blocking resource from another origin without preconnect' },
  'render-document-write': { severity: 'medium', title: 'document.write() in a script delays parsing and can block on network' },
  'render-parser-blocking-body': { severity: 'low', title: 'Synchronous external <script> in <body> blocks parsing of everything after it' },
  'render-too-many-stylesheets': { severity: 'low', title: 'Many render-blocking stylesheets' },
  'render-print-css-blocking': { severity: 'low', title: 'Print/alternate stylesheet without a matching media attribute blocks rendering' },
  'render-large-inline': { severity: 'low', title: 'Very large inline <style> or <script> in <head>' },
  'render-sync-before-css': { severity: 'low', title: 'Synchronous script placed before stylesheets delays CSS discovery' },
  'render-no-critical-css': { severity: 'info', title: 'Blocking CSS over 14 KB and no inline critical CSS' },
};
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const gz = (s) => gzipSync(Buffer.from(s)).length;
const isJsType = (t) => !t || /^(text|application)\/(java|ecma)script$|^module$/i.test(t.trim());
/** True when a <link rel=stylesheet> blocks rendering for screen. */
export function blocksRender(attrs) {
  if (attrs.disabled != null) return false; const rel = (attrs.rel || '').toLowerCase();
  if (/\balternate\b/.test(rel)) return false;
  const media = (attrs.media || 'all').toLowerCase().trim();
  if (/^print$/.test(media) || /\bprint\b/.test(media) && !/\b(all|screen)\b/.test(media)) return false;
  if (/^\(prefers-color-scheme/.test(media) || /orientation|min-width|max-width/.test(media)) return true; // conservative: may match
  return true;
}

function analyze(site, opts, config) {
  const { findings, add } = finder(RULES);
  const cssBudget = opts.maxCss ?? config.maxCss ?? 50 * 1024; const maxSheets = config.maxStylesheets ?? 3; const inlineMax = config.maxInline ?? 50 * 1024;
  const cache = new Map();
  const local = (u) => { if (!u || !site.isInternal(u)) return null; let p = u.pathname; if (site.basePath && p.startsWith(site.basePath)) p = p.slice(site.basePath.length); try { p = decodeURIComponent(p); } catch { /* keep */ } p = p.replace(/^\/+/, ''); if (!cache.has(p)) { const t = site.read(p); cache.set(p, t); } return { rel: p, text: cache.get(p) }; };
  let blockingTotal = 0;
  for (const pg of site.pages) {
    const doc = pg.doc; const head = doc.all.filter((e) => e.inHead);
    const preconnect = new Set(doc.links.filter((l) => l.rel.includes('preconnect')).map((l) => { try { return new URL(l.href, 'https://x.invalid').origin; } catch { return ''; } }));
    const at = (e) => ({ file: pg.file, line: e.line });
    let sheets = 0; let cssBytes = 0; let cssGz = 0; let seenSyncScript = null; let warnedOrder = false; const third = new Set();
    const inlineCss = head.filter((e) => e.tag === 'style').reduce((a, e) => a + (e.rawText || '').length, 0);
    for (const e of head) {
      const a = e.attrs;
      if (e.tag === 'script') {
        const t = a.type; if (!isJsType(t)) continue;
        if (a.src) {
          const isModule = /^module$/i.test(t || ''); if (a.async != null || a.defer != null || isModule) continue;
          const u = site.resolve(pg, a.src); const l = local(u); const size = l?.text != null ? ` (${kb(gz(l.text))} gzip)` : '';
          add('render-blocking-script', a.src, `${pg.path}: <script src="${a.src}">${size} in <head> blocks rendering`, 'Add defer (keeps order, runs after parsing) or async (independent scripts like analytics), or type="module".', at(e));
          seenSyncScript ||= e;
          if (u && !site.isInternal(u) && !preconnect.has(u.origin)) third.add(u.origin);
        } else if (/document\.write\s*\(/.test(e.rawText || '')) add('render-document-write', `${pg.path}:${e.line}`, `${pg.path}: inline script calls document.write()`, 'Insert elements with DOM APIs instead; Chrome may block document.write-injected scripts on slow connections.', at(e));
        else if ((e.rawText || '').length > inlineMax) add('render-large-inline', `${pg.path}:${e.line}`, `${pg.path}: inline <script> of ${kb((e.rawText || '').length)} in <head>`, 'Move it to a cached external file with defer.', at(e));
        continue;
      }
      if (e.tag === 'style') { const css = e.rawText || ''; if (css.length > inlineMax) add('render-large-inline', `${pg.path}:${e.line}`, `${pg.path}: inline <style> of ${kb(css.length)} in <head>`, 'Inline only the critical above-the-fold CSS (under ~14 KB); load the rest from a cached file.', at(e)); if (/@import\s/i.test(css)) add('render-css-import', `${pg.path}:${e.line}`, `${pg.path}: inline <style> uses @import`, 'Replace @import with <link rel="stylesheet"> tags so downloads start in parallel.', at(e)); continue; }
      if (e.tag !== 'link' || !/\bstylesheet\b/i.test(a.rel || '') || !a.href) continue;
      const u = site.resolve(pg, a.href);
      if (!blocksRender(a)) continue;
      if (/(^|[/._-])print([._-]|\.css)/i.test(a.href) && !a.media) add('render-print-css-blocking', a.href, `${pg.path}: ${a.href} looks like a print stylesheet but has no media="print"`, 'Add media="print" so it downloads at low priority without blocking rendering.', at(e));
      sheets++;
      if (seenSyncScript && !warnedOrder) { add('render-sync-before-css', a.href, `${pg.path}: stylesheet ${a.href} comes after a synchronous script (line ${seenSyncScript.line})`, 'Put stylesheets before scripts in <head> (or defer the script) so CSS downloads start immediately.', at(e)); warnedOrder = true; }
      if (u && !site.isInternal(u)) { if (!preconnect.has(u.origin)) third.add(u.origin); continue; }
      const l = local(u); if (l?.text == null) continue;
      cssBytes += l.text.length; cssGz += gz(l.text);
      if (/@import\s/i.test(l.text.replace(/\/\*[\s\S]*?\*\//g, ''))) add('render-css-import', l.rel, `${l.rel} uses @import`, 'Bundle the imported CSS or link it directly, so the browser does not discover it only after downloading this file.', { file: l.rel });
    }
    for (const o of third) add('render-third-party-blocking', `${pg.path}|${o}`, `${pg.path}: render-blocking resource from ${o} without <link rel="preconnect">`, `Self-host it, load it without blocking, or add <link rel="preconnect" href="${o}">.`, { file: pg.file });
    if (sheets > maxSheets) add('render-too-many-stylesheets', pg.path, `${pg.path} has ${sheets} render-blocking stylesheets`, `Combine them (max ${maxSheets}) or load non-critical ones with media/print-onload.`, { file: pg.file });
    if (cssGz > cssBudget) add('render-blocking-css-heavy', pg.path, `${pg.path}: ${kb(cssGz)} gzip (${kb(cssBytes)} raw) of render-blocking CSS (budget ${kb(cssBudget)})`, 'Inline critical CSS (e.g. critters/beasties) and load the rest asynchronously; remove unused CSS.', { file: pg.file });
    else if (cssGz > 14 * 1024 && inlineCss < 500) add('render-no-critical-css', pg.path, `${pg.path}: ${kb(cssGz)} gzip of blocking CSS and no inline critical CSS`, 'Consider inlining above-the-fold CSS so first paint needs only the HTML round trip.', { file: pg.file });
    blockingTotal += cssGz;
    for (const e of doc.all) if (!e.inHead && e.tag === 'script' && e.attrs.src && isJsType(e.attrs.type) && !/^module$/i.test(e.attrs.type || '') && e.attrs.async == null && e.attrs.defer == null) {
      const after = doc.all.indexOf(e); const rest = doc.all.slice(after + 1).filter((x) => !['script', 'noscript', 'template', 'style', 'link'].includes(x.tag) && x.tag !== '#document').length;
      if (rest > 5) add('render-parser-blocking-body', e.attrs.src, `${pg.path}: synchronous <script src="${e.attrs.src}"> in <body> before ${rest} more elements`, 'Move it to the end of <body> or add defer/async.', at(e));
    }
  }
  return { findings, info: { blockingCssGzip: blockingTotal } };
}

export function check(dir, opts = {}, config = {}, configFile) {
  const tool = { name: 'render-pulse', version: opts.toolVersion || '1.0.0', rules: RULES, emoji: '🚦', defaultFile: 'index.html' };
  return runBeacon(tool, dir, { ...opts, UsageError }, config, configFile, analyze, buildReport);
}
