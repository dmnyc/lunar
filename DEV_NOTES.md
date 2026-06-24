# Lunar — dev notes (overhaul)

Working handoff for the **Lunar** rebuild of astral.ninja (web Nostr client).
Lives in the repo so it survives the folder/GitHub rename. **Single branch:
`master`** (the `overhaul`/feature branches were consolidated and deleted;
`master` auto-deploys to lunar.ninja via Vercel on push).

> **Unpushed local commits** (as of this handoff): `cbbda8c`, `e9632c1`,
> `73e9980` — the mobile-OOM work below. Production (lunar.ninja) is still at
> `320c072`. Verify on device, then push `master` when ready.
> Latest test preview: `lunar-htqrcz2up-the-daniels-projects.vercel.app`
> (Vercel previews are public; `vercel deploy` from the working tree).

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

## Mobile OOM crashes — the big theme (in progress)

iOS Safari has a tight per-tab memory ceiling. This 2022 codebase renders full
lists with no virtualization and over-uses Vue deep reactivity, so an account
with **many follows (test account: 1114)** OOM-crashes ("a problem repeatedly
occurred") on almost every list view. **This is systemic, not one bug.** Use the
**Safari Web Inspector** (Mac Safari → Develop → iPhone) — it's the only way to
see the real cause; a clean console + crash = pure memory (profiles/images), a
flooded console = a request storm.

**The fix pattern (proven):** raw data stays OUT of Vue reactivity (`markRaw` /
plain Maps / `shallowRef`), and every long list renders inside a
`q-virtual-scroll` **with a bounded-height scroll container** — without an
explicit height it can't find the window scroller in this layout and renders
EVERY item (verified: 300 items → 300 mounted / 13.7k DOM nodes vs 15 mounted
with a height). Use `height: calc(100svh - Nrem)` (svh, NOT dvh) and **omit
`-webkit-overflow-scrolling: touch`** — its momentum layer crashes on pinch-zoom
inside a nested scroller. iOS ignores `user-scalable=no`, so zoom always works.

**Fixed this session (commits `cbbda8c`/`e9632c1`/`73e9980`):**
- New **`src/nostr/feedEngine.js`** (Jumble-style): events in a plain Map outside
  reactivity; reactive surface is a `shallowRef` of ids; `until`-paginated pages +
  buffered live tail ("load N new"); torn down on `visibilitychange`/unmount.
- **`Feed.vue`** rewritten on the engine + virtualized (`.feed-scroll`).
- **`Profile.vue`** follows/followers virtualized; `dbStreamFollowers` capped
  (limit 300) — it pulls full kind-3 contact lists (huge); removed a
  `followerKeys` watcher that fired per streamed follower.
- **`TheSearchMenu.vue`** follows list virtualized (was rendering all follows on
  open → instant crash).
- **NIP-05 storm killed**: `handleAddingProfileEventToCache` no longer fires a
  per-profile `.well-known/nostr.json` fetch (hundreds of CORS-failing fetches at
  once). Now on-demand only.
- **`markRaw`** on `profilesCache`/`eventsCache` (mutations.js) — the main
  subscription streams kind-0 for every follow; deep-reactive proxies were a
  large, log-invisible memory cost.
- **`namedProfiles`** getter: push instead of O(n²) spread-in-reduce.
- Login now lands on the **feed** (not `/settings?initUser`); removed the
  auto-opening "Your keys" dialog.

**Still open (do as ONE systematic sweep next session):**
- Grep every `v-for` over a big collection and virtualize/bound it. Known
  remaining: **Messages/DM list**, **Notifications**, the **follows-reorder
  Draggable** in `TheSearchMenu` (renders all follows in reorder mode).
- **Images** are the other untested OOM suspect (full-res note images + avatars;
  loading=lazy is on). Get a **memory timeline** on device to confirm
  images-vs-profiles before optimizing (thumbnail proxy? cap concurrent decodes?).
- Auth was a RED HERRING — the `nostr.wine` relays were not erroring. NDK has no
  `relayAuthDefaultPolicy` (does nothing on NIP-42 challenge); leave it unless a
  relay genuinely needs auth, then add `NDKRelayAuthPolicies.signIn({ndk})`.

## NDK / nostr modernization backlog (from a full audit — high→low)
1. **NIP-57 zaps → `NDKZapper`** (`src/nostr/zap.js`, `mixin.js:443`). M
2. **Profile fetch queue → `NDKUser.fetchProfile()` batching** (`actions.js:371-410`). M
3. **NIP-04/kind-4 DMs → NIP-17/NIP-44** (`actions.js:150`, `mixin.js:327`,
   `query.js:203-219`). NIP-44 primitives already exist in `encryptionService.js`. L
4. **(done)** deep-reactive caches → `markRaw`. Long term: move to Pinia
   `shallowRef`/Map.
5. **NIP-65 load → `NDKRelayList` / `autoConnectUserRelays`** (`actions.js:41-63`). S
6. kind-3 publish still embeds relay JSON in content → emit kind-10002
   (`actions.js:215`). S
7. `streamMainProfilesFollows` passes unbounded authors → chunk to ≤500 / outbox
   (`actions.js:75`, `query.js:185`). S–M
8. **(done)** `nip05.queryProfile` bulk verify removed; long term use
   `ndk.getUserFromNip05()` for on-demand (`actions.js:463`, `Settings.vue:227`).
9. NWC uses NIP-04 (spec-correct); `@getalby/sdk` is an unused dep on this path. S
10. Profile search hand-rolls a Primal WebSocket → NDK `search` filter
    (`profileSearch.js`). M
11. No `visibilitychange` gating on `unread.js` streams (handler commented in
    `MainLayout.vue`). S
12. `ndk-cache-dexie` unconfigured + DB still named `astral-ndk-cache`
    (`ndk.js:38`); add `expiresAt`, rename. S
13. Delete dead `src/*.worker.js` (relay/query/db/event). S
14. `store/state.js` default relays are dead 2022 list → import `DEFAULT_RELAYS`
    from `ndk.js`. S
15. `signAsynchronously` bypasses NDK for local keys → always `NDKEvent.sign()`
    (`utils/event.js:44`). S

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
