# Lunar — dev notes (overhaul)

Working handoff for the **Lunar** rebuild of astral.ninja (web Nostr client).
Lives in the repo so it survives the folder/GitHub rename. Branch: **`overhaul`**
(off `master`).

## Conventions
- Commit only when asked; **never push** without explicit permission; no Claude
  co-author in commits. Never stage `.DS_Store`.
- **Runtime-verify** router/config changes — a passing `quasar build` does NOT
  catch runtime errors (a Vue Router param-regex group once blanked the app).
  Quick check: `quasar dev` + headless Chrome dump for `Uncaught`.
- NWC providers to suggest: **Alby Hub, Yakihonne, Rizful, Minibits** only —
  never Primal or Coinos.
- **Do not use nostr.band** (relay or API).

## Rename still TODO (run in a fresh terminal, breaks the working dir)
```bash
gh repo rename lunar -R dmnyc/astral          # GitHub repo
cd ~/GitHub && mv astral lunar && cd lunar     # local folder
git remote set-url origin https://github.com/dmnyc/lunar.git
mv ~/.claude/projects/-Users-daniel-GitHub-astral \
   ~/.claude/projects/-Users-daniel-GitHub-lunar   # Claude memory dir
```
After: check the Docker build GitHub Action + any lunar.ninja deploy/DNS.

## Architecture (the important seams)
- **Toolchain:** `@quasar/app-vite` v1 (CommonJS `quasar.config.js`, async fn +
  dynamic import for ESM `vite-plugin-node-polyfills`). Vue 3 + Quasar 2.
- **State:** legacy **Vuex** still drives feed/profile UI; **Pinia**
  (`src/boot/pinia.js`) backs new stores (wallet). Deliberate dual-store during
  migration.
- **Nostr core:** single **NDK** instance `src/nostr/ndk.js` (Dexie cache).
  `src/query.js` is THE seam — it kept the old worker API's exact signatures +
  `{update, cancel}` stream contract (callbacks get ARRAYS) but runs on NDK, so
  all ~50 components + the Vuex store work unchanged. Reads use an EOSE+timeout
  `collect()` because NDK 2.10 `fetchEvents` hangs on `#p` filters. Profile /
  relay-list reads use `PARALLEL` cache so the newest kind-0 wins.
- **Signers:** `src/nostr/authManager.js` (NIP-07, NIP-46 bunker:// +
  nostrconnect, nsec) + `nip46Rpc.js` + `nip44LocalSigner.js`. Signing routes
  through the active NDK signer (`src/utils/event.js` signAsynchronously).
  Restored on reload via `src/boot/auth.js`.
- **nostr-tools v1→v2 shim:** `src/utils/ntcompat.js` (only ~3 legacy files use
  the changed surface). New code uses nostr-tools v2 / NDK directly.
- **Old sql.js workers** (`*.worker.js`) are orphaned/unused — delete in Phase 6.

## Done (committed on `overhaul`)
- Vite/Pinia/NDK toolchain; NDK seam; signers NIP-07/46/nsec.
- NIP-89 client tag `["client","lunar"]`.
- NIP-27 mentions: **emit nevent**, accept both note+nevent. Vue Router needs
  SEPARATE routes for `note1…` / `nevent1…` (no `(?:…)` group). `bech32ToHex`
  decodes nevent/nprofile → hex.
- Latest kind-0 + NIP-65 (kind 10002) relays adopted on launch.
- Show kind-0 `display_name` (name/displayName/hasName getters prefer it).
- Post box: localStorage drafts, image upload (nostr.build NIP-98,
  `src/nostr/mediaUpload.js`), live preview, send countdown/undo, paste-image →
  upload + thumbnail strip.
- Wallet: NWC (NIP-47 over NDK, `src/nostr/wallet/nwc.js`) + WebLN + NIP-57 zaps
  (`src/nostr/zap.js`). Pinia `src/stores/wallet.js`. `/wallet` page +
  `BaseWalletCard` (balance / send / receive / NWC tx history) + sidebar balance
  pill (between Wallet & Settings) + zap attribution (pfp/name parsed from the
  kind-9734 in the NWC tx description). Connect/disconnect (confirm) in
  `BaseWalletConnect`.
- Profile **name search** via Primal `user_search` (+ NIP-50 fallback over
  noswhere/nos.today, NOT nostr.band): `src/nostr/profileSearch.js`, wired into
  `TheSearchMenu` (search-as-you-type results).
- Rebrand astral→Lunar (copy, titles, client tag, app id, logo, OG tags).
- **Backup-to-nostr**: NWC connection string backed up via NIP-78 (kind 30078,
  d-tag `lunar-nwc-backup`), NIP-44 encrypted to self. `src/nostr/encryptionService.js`
  (signer-agnostic self encrypt/decrypt: local key / NIP-07 / NIP-46 RPC) +
  `src/nostr/wallet/nwcBackup.js` (signs via signAsynchronously → query.publish
  so local-key users work). Back up / restore buttons in `BaseWalletConnect`.

## Gotchas
- `$primary` is **white** (#ffffff) → any FILLED `q-btn color="primary"` is
  white-on-white. Use `text-color="dark"` or `outline`.
- `localStorage` keys are still `astral_*` and NDK cache `astral-ndk-cache`
  (kept to preserve sessions through the rebrand). Migrate later with an old→new
  copy if desired.

## Next / pending
1. **Spark wallet** — `@breeztech/breez-sdk-spark` (big WASM). Currently
   scaffolded as "coming soon" (kind 4) in the wallet store. zapcooking
   `src/lib/spark/` is the reference.
2. **Phase 6 polish** — re-enable PWA (then remove `src/boot/unregister-sw.js`),
   delete orphaned `src/*.worker.js` + sql.js, NIP-65 relay management UI,
   migrate `astral_*` storage keys if wanted.

## Reference repos (local)
- `~/GitHub/zapcooking` — NDK + Dexie + NWC (@getalby/sdk) + Spark
  (@breeztech/breez-sdk-spark); authManager/nip46Rpc/nip44LocalSigner/wallet/
  spark are the source ports.
- `~/GitHub/jumble-spark` — React equivalents (Spark).
- `~/GitHub/plebs-vs-zombies` — profile search (Vue + NDK, Primal user_search).
