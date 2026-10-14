#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { mainCli, check, RULES, SITE_OPTIONS, SITE_HELP } from '../src/index.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
mainCli({
  name: 'render-pulse', version: pkg.version, configKey: 'renderPulse', rules: RULES,
  tagline: 'find render-blocking CSS and JS in your built site',
  usage: 'Usage: render-pulse [site-dir] [options]',
  help: `${SITE_HELP}Render
      --max-css-kb <n>         Render-blocking CSS budget per page, gzip KB (default 50)
`,
  options: { ...SITE_OPTIONS, 'max-css-kb': { type: 'string' } },
  run: async ({ dir, values: o, config, configFile }) => check(dir, { cli: o, maxCss: o['max-css-kb'] != null ? Number(o['max-css-kb']) * 1024 : undefined, toolVersion: pkg.version }, config, configFile),
});
