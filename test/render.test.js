import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, blocksRender, runCli, RULES } from '../src/index.js';

const ids = (r) => [...new Set(r.findings.map((f) => f.rule))].sort();
const io = () => { const o = { s: '', e: '' }; return { o, io: { stdout: { write: (x) => { o.s += x; } }, stderr: { write: (x) => { o.e += x; } } } }; };
const site = (head, body = '<p>x</p>', files = {}) => { const d = mkdtempSync(join(tmpdir(), 'rp-')); mkdirSync(join(d, 'c')); writeFileSync(join(d, 'index.html'), `<!doctype html><html><head><title>t</title>${head}</head><body>${body}</body></html>`); for (const [k, v] of Object.entries(files)) writeFileSync(join(d, k), v); return d; };

test('blocksRender', () => {
  assert.equal(blocksRender({ rel: 'stylesheet' }), true); assert.equal(blocksRender({ rel: 'stylesheet', media: 'print' }), false);
  assert.equal(blocksRender({ rel: 'alternate stylesheet' }), false); assert.equal(blocksRender({ rel: 'stylesheet', disabled: '' }), false);
  assert.equal(blocksRender({ rel: 'stylesheet', media: 'screen and (min-width: 900px)' }), true);
});
test('good fixture is clean (even at info)', () => assert.deepEqual(ids(check('test/fixtures/good')), []));
test('bad fixture', () => assert.deepEqual(ids(check('test/fixtures/bad')), ['render-blocking-css-heavy', 'render-blocking-script', 'render-css-import', 'render-document-write', 'render-parser-blocking-body', 'render-print-css-blocking', 'render-sync-before-css', 'render-third-party-blocking', 'render-too-many-stylesheets']));
test('defer, async, module and JSON scripts do not block', () => assert.deepEqual(ids(check(site('<script defer src="/a.js"></script><script async src="/b.js"></script><script type="module" src="/c.js"></script><script type="application/json" src="/d.json"></script><script type="text/plain" src="/e.js"></script>'))), []));
test('preconnect satisfies third-party rule but not blocking-script', () => assert.deepEqual(ids(check(site('<link rel="preconnect" href="https://cdn.x.io"><script src="https://cdn.x.io/a.js"></script>'))), ['render-blocking-script']));
test('inline @import and large inline style', () => {
  assert.deepEqual(ids(check(site('<style>@import url(/c/a.css);</style>'))), ['render-css-import']);
  assert.deepEqual(ids(check(site(`<style>${'.a{color:red}'.repeat(5000)}</style>`))), ['render-large-inline']);
});
test('no critical CSS hint for mid-size blocking CSS; budget option', () => {
  let css = ''; for (let i = 0; css.length < 80000; i++) css += `.k${i}{margin:${i % 97}px;color:#${(i * 99991).toString(16).slice(-6)}}`;
  const d = site('<link rel="stylesheet" href="/c/s.css">', '<p>x</p>', { 'c/s.css': css });
  assert.deepEqual(ids(check(d)), ['render-no-critical-css']);
  assert.deepEqual(ids(check(site(`<style>${'.hero{padding:1rem}'.repeat(40)}</style><link rel="stylesheet" href="/c/s.css">`, '<p>x</p>', { 'c/s.css': css }))), []);
  assert.deepEqual(ids(check(d, { maxCss: 1024 })), ['render-blocking-css-heavy']);
});
test('body script at the end is fine', () => assert.deepEqual(ids(check(site('', '<main><p>1</p><p>2</p><p>3</p><p>4</p><p>5</p><p>6</p></main><script src="/a.js"></script>'))), []));
test('CLI exit codes and SARIF', async () => {
  const cli = { name: 'render-pulse', version: '1.0.0', configKey: 'renderPulse', rules: RULES, tagline: 't', usage: 'u', help: '', options: {}, run: async ({ dir, config }) => check(dir, {}, config) };
  let t = io(); assert.equal(await runCli(cli, ['test/fixtures/good', '--fail-on', 'info'], t.io), 0);
  t = io(); assert.equal(await runCli(cli, ['test/fixtures/bad', '-f', 'sarif'], t.io), 1); assert.equal(JSON.parse(t.o.s).version, '2.1.0');
  t = io(); assert.equal(await runCli(cli, ['test/fixtures/none'], t.io), 2);
});
