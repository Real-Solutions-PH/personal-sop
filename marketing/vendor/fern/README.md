# Fern renderer (vendored)

`fern.js` and `fern.css` draw Fern, the C1 wreath sprite Kai approved on 2026-11-03. They are copied unchanged from the Unfurl card library, by way of the private unfurl-marketing video kit (`video/projects/say-it-tracked/assets/kit/brand/`).

`scripts/gen-fern.mjs` runs `fern.js` at build time and writes one standalone SVG per mood to `public/fern/`. The browser never loads these two files.

Update them by copying newer versions from the card library. Do not edit them here.
