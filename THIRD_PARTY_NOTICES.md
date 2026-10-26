# Third party notices

Files in this repository that come from other projects, with their source, exact version and licence. Each licence was
checked at its source on 2026-10-25. Exact sha256 of every file: `web/vendor/wallets/SHA256SUMS` and docs/VERSIONS.md.
The full licence texts are at the end of this file.

| File | What it is | Source and exact version | Licence |
| --- | --- | --- | --- |
| `web/vendor/near-connect.js` | NEAR Connect, the wallet connector, bundled into one file by `scripts/wallet-vendor/build.sh` | npm `@hot-labs/near-connect` 0.11.4 (repository github.com/hot-dao/near-selector, now github.com/azbang/near-connect); exact install in `scripts/wallet-vendor/package-lock.json` | MIT, declared in the package's `package.json` and on npm. The repository has no licence text file. The bundle also holds esbuild's small runtime helpers (esbuild 0.25.10, MIT) |
| `web/js/logo.js`, `web/favicon.svg`, `web/favicon-*.png`, `web/social.png` | The mark: the outline of the letter S of Archivo ExtraBold, turned into an SVG path (`scripts/logo/extract_s.mjs`), with a crack drawn over it | Archivo by Omnibus-Type, Google Fonts static weight 800 file (Version 2.001), sha256 `f734704aebd9faeca392e0d7e48007e8776d5727ffccf1648611f6cd768eb296` | SIL Open Font License 1.1 (the font); the drawing made from one glyph is not a font |
| `web/vendor/wallets/manifest.json` | The site's wallet list: two entries taken from NEAR Connect's public wallet manifest, each pointing at the wallet's official script address, with that script's sha256 added (`scripts/wallet-vendor/fetch_wallets.sh`) | `repository/manifest.json` of github.com/hot-dao/near-selector at commit `6766ea5e71864e5cbcbf5b70d2aeae23b20b60e9` | MIT, as declared in that repository's `package.json` (no licence text file in the repository) |

Not stored in the repository, loaded by the site at run time:

| What | Loaded from | Pinned by | Licence |
| --- | --- | --- | --- |
| The Intear Wallet script for NEAR Connect | https://wallet.intear.tech/near-selector.js (no versioned address); built from `web/src/js/near-selector.js` in github.com/INTEARnear/wallet | sha256 `6decc283352af197feff4988628899d19e05f4168a4277fe699bd8a0d6178e34`, checked by `web/js/wallet.js` before the script may run | AGPL-3.0, the licence of the INTEARnear/wallet repository |
| The NEAR CLI wallet script for NEAR Connect | `dist/near-cli.js` of github.com/near/near-cli-connect at commit `dc5cb123e3a8e42ed095739f4ea058b767a80ad2`, from raw.githubusercontent.com | sha256 `522f2a52403f6da84384a409718c54b49ed4432cdfd583363d35109be8c8e318`, checked the same way | Not declared: the repository has no licence file and its `package.json` has no licence field |
| Fonts IBM Plex Sans, JetBrains Mono and Archivo (ExtraBold, only the letters of the name) | Google Fonts | none | SIL Open Font License 1.1 |
| Each wallet's own site, when a visitor uses it | wallet.intear.tech | none | that wallet's own terms |

## Licence texts

### NEAR Connect (`@hot-labs/near-connect` 0.11.4), in `web/vendor/near-connect.js`

The package declares the MIT licence and names HOT Labs as its author in its `package.json`; it ships no licence text
file, so this is the standard MIT text with that author.

    MIT License

    Copyright (c) HOT Labs

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.

### esbuild 0.25.10 runtime helpers, in `web/vendor/near-connect.js`

From the package's `LICENSE.md`:

    MIT License

    Copyright (c) 2020 Evan Wallace

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.
