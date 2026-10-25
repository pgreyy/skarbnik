# Third party notices

Files in this repository that come from other projects, with their source, exact version and licence. Each licence was
checked at its source on 2026-10-25. Exact sha256 of every file: `web/vendor/wallets/SHA256SUMS` and docs/VERSIONS.md.

| File | What it is | Source and exact version | Licence |
| --- | --- | --- | --- |
| `web/vendor/near-connect.js` | NEAR Connect, the wallet connector, bundled into one file by `scripts/wallet-vendor/build.sh` | npm `@hot-labs/near-connect` 0.11.4 (repository github.com/hot-dao/near-selector, now github.com/azbang/near-connect); exact install in `scripts/wallet-vendor/package-lock.json` | MIT, declared in the package's `package.json` and on npm. The repository has no licence text file. The bundle also holds esbuild's small runtime helpers (esbuild 0.25.10, MIT) |
| `web/vendor/wallets/manifest.json` | The site's wallet list: two entries taken from NEAR Connect's public wallet manifest, with the script paths changed to the local copies | `repository/manifest.json` of github.com/hot-dao/near-selector at commit `6766ea5e71864e5cbcbf5b70d2aeae23b20b60e9` | MIT, as declared in that repository's `package.json` (no licence text file in the repository) |
| `web/vendor/wallets/near-cli.js` | The NEAR CLI wallet script for NEAR Connect | `dist/near-cli.js` of github.com/near/near-cli-connect at commit `dc5cb123e3a8e42ed095739f4ea058b767a80ad2` | NOT DECLARED: the repository has no licence file and its `package.json` has no licence field. The file bundles buffer (MIT, Feross Aboukhadijeh), ieee754 (BSD-3-Clause, Feross Aboukhadijeh), mustache.js (MIT) and scure-base (MIT, Paul Miller), whose notices are kept inside the file |
| `web/vendor/wallets/intear-wallet.js` | The Intear Wallet script for NEAR Connect | https://wallet.intear.tech/near-selector.js, fetched 2026-10-25 (no versioned address); built from `web/src/js/near-selector.js` in github.com/INTEARnear/wallet (`build-js.js`) | AGPL-3.0, the licence of the INTEARnear/wallet repository. The corresponding source is that repository |

Not stored in the repository, loaded by the site at run time: the fonts Young Serif, Archivo and Space Mono from Google
Fonts (SIL Open Font License 1.1), and each wallet's own site when a visitor uses it (wallet.intear.tech).
