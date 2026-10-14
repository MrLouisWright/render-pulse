# Changelog

## 1.0.0 (2026-10-14)

First release, by Louis Wright.

- Head scripts without defer/async/module, synchronous body scripts that block parsing, document.write.
- Render-blocking stylesheets: gzip budget per page, count, @import chains (files and inline), print CSS without media, stylesheets placed after sync scripts, missing critical CSS.
- Third-party render-blocking resources without preconnect.
- Text/JSON/SARIF/Markdown output, `--fail-on`, exit codes 0/1/2, allowlist with expiry, severity overrides.
- Composite GitHub Action with job summary.
