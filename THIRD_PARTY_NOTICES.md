# Third party notices

Files in this repository that come from other projects, with their source, exact version and licence. Each licence was
checked at its source on 2026-10-25. Exact sha256 of every file: `web/vendor/wallets/SHA256SUMS` and docs/VERSIONS.md.
The full licence texts are at the end of this file.

| File | What it is | Source and exact version | Licence |
| --- | --- | --- | --- |
| `web/vendor/near-connect.js` | NEAR Connect, the wallet connector, bundled into one file by `scripts/wallet-vendor/build.sh` | npm `@hot-labs/near-connect` 0.11.4 (repository github.com/hot-dao/near-selector, now github.com/azbang/near-connect); exact install in `scripts/wallet-vendor/package-lock.json` | MIT, declared in the package's `package.json` and on npm. The repository has no licence text file. The bundle also holds esbuild's small runtime helpers (esbuild 0.25.10, MIT) |
| `web/js/logo.js`, `web/favicon.svg`, `web/favicon.ico`, `web/favicon-*.png`, `web/apple-touch-icon.png`, `web/icon-*.png`, `web/social.png` | The mark "S12": the letter S of Fraunces SemiBold as a vector path, with a gold vein drawn over it, from the approved design (its `logo/` files; the favicon SVG is its `logo/favicon.svg` unchanged) | Fraunces by Undercase Type (Google Fonts) | SIL Open Font License 1.1 (the font); the drawing made from one glyph is not a font |
| `web/vendor/wallets/manifest.json` | The site's wallet list: all 14 entries of NEAR Connect's public wallet manifest, each pointing at the wallet's official script address (a GitHub script at a fixed commit), with that script's sha256 added (`scripts/wallet-vendor/fetch_wallets.sh`) | `repository/manifest.json` of github.com/hot-dao/near-selector at commit `5385297f1ebd21af648c99fa347eac28ba55d462` | MIT, as declared in that repository's `package.json` (no licence text file in the repository) |

Not stored in the repository, loaded by the site at run time:

| What | Loaded from | Pinned by | Licence |
| --- | --- | --- | --- |
| The Intear Wallet script for NEAR Connect | https://wallet.intear.tech/near-selector.js (no versioned address); built from `web/src/js/near-selector.js` in github.com/INTEARnear/wallet | sha256 `6decc283352af197feff4988628899d19e05f4168a4277fe699bd8a0d6178e34`, checked by `web/js/wallet.js` before the script may run | AGPL-3.0, the licence of the INTEARnear/wallet repository |
| The NEAR CLI wallet script for NEAR Connect | `dist/near-cli.js` of github.com/near/near-cli-connect at commit `dc5cb123e3a8e42ed095739f4ea058b767a80ad2`, from raw.githubusercontent.com | sha256 `522f2a52403f6da84384a409718c54b49ed4432cdfd583363d35109be8c8e318`, checked the same way | Not declared: the repository has no licence file and its `package.json` has no licence field |
| The HOT Wallet script for NEAR Connect (not shown on testnet) | https://raw.githubusercontent.com/hot-dao/near-selector/5385297f1ebd21af648c99fa347eac28ba55d462/repository/hotwallet.js | sha256 `7597090092612c66856548528043094ff418ab09dea85e886f921c6f6f1277fb`, checked the same way | MIT, declared in the hot-dao/near-selector `package.json` |
| The MyNearWallet script for NEAR Connect | https://raw.githubusercontent.com/hot-dao/near-selector/5385297f1ebd21af648c99fa347eac28ba55d462/repository/mnw.js | sha256 `428055aeb7ea018f2e041babf0bfeb33fcf1f0a69b7865e9887a17b9e6f559ca`, checked the same way | MIT, declared in the hot-dao/near-selector `package.json` |
| The OKX Wallet script for NEAR Connect (not shown on testnet) | https://raw.githubusercontent.com/hot-dao/near-selector/5385297f1ebd21af648c99fa347eac28ba55d462/repository/okx.js | sha256 `e0a6bad07df32596dcdbf6f47396749e03be15f580da0726fa557e0e058891d8`, checked the same way | MIT, declared in the hot-dao/near-selector `package.json` |
| The Nightly Wallet script for NEAR Connect | https://raw.githubusercontent.com/hot-dao/near-selector/5385297f1ebd21af648c99fa347eac28ba55d462/repository/nightly.js | sha256 `6e769f105fb30d37501439287ec901b4d858a503ab195e2e99c06c172c5b5d48`, checked the same way | MIT, declared in the hot-dao/near-selector `package.json` |
| The Wallet Connect script for NEAR Connect | https://raw.githubusercontent.com/hot-dao/near-selector/5385297f1ebd21af648c99fa347eac28ba55d462/repository/wallet-connect.js | sha256 `65a8bc0f9b8f73d49249872d76e2d931dd93e69e2f87498b0d89a76ada21bbc1`, checked the same way | MIT, declared in the hot-dao/near-selector `package.json` |
| The Unity Wallet script for NEAR Connect | https://raw.githubusercontent.com/hot-dao/near-selector/5385297f1ebd21af648c99fa347eac28ba55d462/repository/wallet-connect.js | sha256 `65a8bc0f9b8f73d49249872d76e2d931dd93e69e2f87498b0d89a76ada21bbc1`, checked the same way | MIT, declared in the hot-dao/near-selector `package.json` |
| The Meteor Wallet script for NEAR Connect | https://raw.githubusercontent.com/Meteor-Wallet/meteor_wallet_sdk/e0a7d48a07d1a02e69921aa6624f0f7a1f3f3ddf/storage/meteor-near-connect-latest.js | sha256 `3b4befc73afc582657a49a374682ee9c4a4f57c92312d8cd441463679097ce94`, checked the same way | GPL-3.0, the licence of the Meteor-Wallet/meteor_wallet_sdk repository |
| The Ledger script for NEAR Connect | https://raw.githubusercontent.com/near/near-connect-ledger/a705e63c3543982f8d3d788a216e5e5cb53c676d/ledger-executor.js | sha256 `e3b4569f91aa57fe0c4217c4b0cc394a991f582ae7961fb60b0abed5ade51729`, checked the same way | Not declared: the near/near-connect-ledger repository has no licence file |
| The Hana Wallet script for NEAR Connect (not shown on testnet) | https://raw.githubusercontent.com/Hana-Technology/near-connect/93237ea1b59d439451b7a08a97085f411274c250/repository/hana.js | sha256 `ef6c88f45bb7ea68e0c5878d4b135c2b4d3e0b0544a3c952a5aae72dcb1bdd62`, checked the same way | MIT, declared in the Hana-Technology/near-connect `package.json` |
| The NEAR Mobile script for NEAR Connect (not shown on testnet) | https://near-mobile-production.aws.peersyst.tech/connector/near-connect.js | sha256 `df84681559dee638491c158377627a78819fe96fe4be7f8cbad2c756e4e913e7`, checked the same way | Not checked: served by the wallet's own site |
| The Trezu Wallet script for NEAR Connect (not shown on testnet) | https://trezu.app/_next/static/near-connect/trezu-wallet.js | sha256 `c6883a75ddb0d196818736881208cf4a47df75c26d3e1cae2abd96d970b2321d`, checked the same way | Not checked: served by the wallet's own site |
| The Ethereum Wallets script for NEAR Connect | https://evm-on-near.dev/executor.js | sha256 `0480ca7b4d2204b1702a554e92f6d00d69a780ff1dee9dcf67feb6ae7991556b`, checked the same way | Not checked: served by the wallet's own site |
| Fonts Space Grotesk (600), IBM Plex Sans (500, 600), JetBrains Mono (400, 700) and Fraunces (600, only the letters of the name) | Google Fonts | none | SIL Open Font License 1.1 |
| Each wallet's own site or app, when a visitor uses it | for example wallet.intear.tech, wallet.meteorwallet.app, testnet.mynearwallet.com, evm-on-near.dev | none | that wallet's own terms |

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
