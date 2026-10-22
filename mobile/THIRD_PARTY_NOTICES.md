# Third-party notices

## Fonts

The app bundles these typefaces (ADR-0019). Both are licensed under the
SIL Open Font License, Version 1.1. The full licence text ships inside each
package as `LICENSE_FONT` (`node_modules/@expo-google-fonts/geist/LICENSE_FONT`
and `node_modules/@expo-google-fonts/geist-mono/LICENSE_FONT`) and at
https://openfontlicense.org.

| Font | Weights bundled | Package | Copyright |
|---|---|---|---|
| Geist | 400, 500, 600 | `@expo-google-fonts/geist` (MIT wrapper) | Copyright 2024 The Geist Project Authors (https://github.com/vercel/geist-font) |
| Geist Mono | 400, 500 | `@expo-google-fonts/geist-mono` (MIT wrapper) | Copyright 2024 The Geist Project Authors (https://github.com/vercel/geist-font) |

The web app loads the same families through `next/font/google`, which
self-hosts them at build time under the same licence.
