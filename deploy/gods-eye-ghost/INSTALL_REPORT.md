# INSTALL REPORT — God's Eye View, Ghost Edition (baseline)

**Final status: PASS WITH EXTERNAL FEED LIMITATIONS — except one acceptance criterion, which FAILS: the keyless globe renders no map imagery.**

See §9. Everything else in the baseline is green. No Tommy code has been merged.

---

## 1. Run metadata

| Field | Value |
|---|---|
| Date / time | 2026-08-26, ~11:40–12:50 local |
| Operator | Claude Code (automated), for amelliamendel@gmail.com |
| Task doc | `G:\tommy\Claude_Code_Task_Install_Gods_Eye_Ghost_Edition.docx` (v1.1) |
| Deployment dir | `G:\tommy\deploy\gods-eye-ghost\` |
| Donor checkout | `G:\tommy\donors\gods-eye-ghost\` (pristine) |

## 2. Host inventory (pre-install)

| Field | Value |
|---|---|
| Hostname | SERVER-AMELLIA0 |
| OS | Microsoft Windows 10 Enterprise LTSC, 10.0.19044 Build 19044, x64 (native Windows, not WSL) |
| CPU | Intel Xeon E5-2683 v4 @ 2.10 GHz (×2 sockets reported) |
| RAM | 130,984 MB |
| GPU | NVIDIA Tesla P40; NVIDIA GeForce GTX 1080 Ti |
| Install volume free (G:) | 78.1 GB before install |
| Node.js (pre-existing) | **none installed** |
| npm (pre-existing) | none |
| Git | 2.54.0.windows.1 |
| Chrome | 151.0.7922.170 (`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`) |
| Edge | 151.0.4129.107 |
| WebGL 2 | **Yes** — verified in real Chrome: `ANGLE (NVIDIA, NVIDIA GeForce GTX 1080 Ti (0x00001B06) Direct3D11 vs_5_0 ps_5_0, D3D11)` |
| Port 4173 | Free before install |
| Existing GEV / Ghost checkout | **None** — nothing was overwritten |
| Admin elevation | **Not held** (`IsInRole(Administrator)` = False) |
| Network | github.com:443, registry.npmjs.org:443, nodejs.org:443 all reachable |

## 3. Prerequisites installed

Node was absent, so a runtime was required. Because the session holds **no admin rights**, and because the user asked that things be installed under `G:\tommy` where possible, Node was installed as a **portable ZIP** — no MSI, no elevation, no PATH/registry/system change, no reboot.

| Item | Value |
|---|---|
| Node | **v22.23.2** (Jod, 22 LTS) — `G:\tommy\tools\node\` |
| npm | **10.9.8** (bundled) |
| Source | `https://nodejs.org/dist/v22.23.2/node-v22.23.2-win-x64.zip` |
| SHA-256 | `1177b4137ba5adaa56354ae40f1080c7450e8ae09cecb47da459d1c52ac99f97` |
| Checksum | **Verified** against the official `SHASUMS256.txt` before extraction |

Caches were redirected onto `G:` to keep the near-full C: drive (26.5 GB free) untouched:
`npm_config_cache=G:\tommy\cache\npm`, `PUPPETEER_CACHE_DIR=G:\tommy\cache\puppeteer`.

**Not installed and not needed:** Visual C++ Build Tools (no dependency fell back to source compilation), Python, Docker, WSL, database, PM2/NSSM, media components. No firewall rule was added. No system or security setting was modified.

## 4. Source provenance

| Field | Value |
|---|---|
| Repository | `https://github.com/Gh0st-mods/Gods-Eye-Ghost-Edition` |
| Commit SHA | **`2c4de78b4643a4f86e934cd37bcbd25540bca3f3`** (branch `main`) |
| Matches doc's observed HEAD | **Yes** — identical to the SHA recorded in the task document |
| Supplied ZIP archive | **Not present on this server.** The reviewed SHA-256 `a5040a96…4750210` could not be checked because no archive was supplied. Installed from GitHub instead, per Phase 3. |
| Working tree | Clean (`git status --porcelain` empty) |

**Upstream docs confirmed absent, as the task doc predicted** — recorded, not compensated for: `DATA_SOURCES.md`, `SECURITY.md`, `TESTING.md`, `LICENSE`. The donor was not altered to add them.

## 5. Dependency install

| Field | Value |
|---|---|
| Command | **`npm ci`** (not `npm install`) |
| Flags | **None.** No `--force`, no `--legacy-peer-deps`, no `--ignore-scripts` |
| Result | `added 198 packages, and audited 199 packages in 2m` |
| lockfileVersion | **3** — confirmed |

**Engine constraint verified directly from the lockfile, not the README.** `package.json` declares `engines.node >= 18`, but the checked-in lockfile resolves:

- `cesium` **1.138.0** → `engines.node >= 20.19.0`
- `@cesium/engine` **22.3.0** → `engines.node >= 20.19.0`
- `@cesium/widgets` **14.3.0** → `engines.node >= 20.19.0`

Node 22.23.2 satisfies the real `>= 20.19` floor. The task doc's finding is confirmed exactly.

`npm ls --depth=0`: `@mapbox/vector-tile@3.0.0`, `cesium@1.138.0`, `egm96-universal@1.1.1`, `mgrs@2.1.0`, `pbf@5.1.2`, `puppeteer@24.37.5`, `satellite.js@6.0.2`, `sharp@0.34.5`, `vite-plugin-cesium@1.2.23`, `vite@6.4.3`, `ws@8.21.0`.

Puppeteer downloaded its own Chrome-for-Testing **145.0.7632.77** into `G:\tommy\cache\puppeteer`. `PUPPETEER_SKIP_DOWNLOAD` was **not** used — the managed browser guarantees version parity with puppeteer 24 and cost only disk, which is plentiful.

**`npm audit`: 9 high-severity advisories** (`nanoid`, `postcss` ≤8.5.22, `sharp` <0.35.0 / libvips CVE-2026-33327/33328/35590/35591). **Recorded, deliberately NOT fixed** — `npm audit fix` would mutate the pinned lockfile and destroy the reproducible baseline. Flagging for a decision before this donor is promoted beyond localhost.

## 6. Environment defect found and fixed

`npm test` first ran **2568 pass / 30 fail**. The 30 failures were **not** code defects.

Git for Windows ships `core.autocrlf=true` at system level, and this repo has **no `.gitattributes`**, so every file was checked out **CRLF**. Large parts of this suite regex-match *source text* with newline-literal patterns, e.g. `/enter\(\) \{([\s\S]*?)\n  \}\n\n  exit\(/` in `src/cameraHandoff.test.mjs`. Under CRLF those patterns cannot match, and the tests fail with `"Cockpit enter is missing"`.

Fix applied — **restores the donor's true upstream bytes rather than editing anything**:

```
git config core.autocrlf false     # repo-local ONLY
git rm --cached -r -q .
git reset --hard HEAD
```

Global and system git config were **not** touched. After the fix `src/ui.js` holds 10,298 LF and 0 CRLF; the only tracked files still containing `\r\n` are binary GIFs under `docs/media/` (incidental byte pairs). HEAD unchanged at `2c4de78…`, working tree clean.

**This drops failures from 30 → 6.** No test and no source file was edited.

> Anyone re-cloning this donor must set `core.autocrlf=false` **before** checkout, or 24 tests will fail spuriously.

## 7. Build and test results

Exact figures from this checkout — nothing hard-coded.

| Step | Command | Result |
|---|---|---|
| Build | `npm run build` | **PASS** — 158 modules, built in 10.48s. Chunk-size warnings only. |
| Unit tests | `npm test` | **2592 pass / 6 fail** of 2598 (2530 top-level), 95.9s |
| Track regression | `npm run test:track` | **94 pass / 6 fail / 0 skipped** — *"no console errors across the FULL run: clean"*, *"no HTTP 5xx: clean"* |
| Map source tray QA | `npm run qa:map-source-tray` | **8 pass / 3 fail, then the harness crashed** (see below) |

Logs: `logs/unit-tests-run1.log` (pre-fix), `logs/unit-tests-run2.log` (post-fix), `logs/test-track.log`, `logs/qa-map-source-tray.log`.

### The 6 remaining unit failures — pre-existing fork drift, not install defects

Identical in both runs, deterministic, network-independent, and none prevent boot:

1. **`cable ground lines classify against exactly the active surface on every stack`** — a **real fork bug**. The fork added `esri-aerial` to `MAP_STACKS` (`src/mapStackController.js:29`) — and it is the *keyless default* (`src/main.js:178`: `tileset ? 'photoreal' : 'esri-aerial'`) — but never added its cable-classification mapping. The fork's own guard fires exactly as designed: *"a stack added to MAP_STACKS without a mapping here silently loses its halved command set."* Effect: submarine-cable ground lines fall back to `BOTH` instead of `TERRAIN` on the default keyless stack.
2. **`the voice TOOL SCHEMA is byte-identical to main`** — frozen-digest drift: block is **31086** bytes vs the pinned **31104**.
3. **`no unchanged Realtime tool definition drifts silently`** — digest `14848f80ebf727b6` vs pinned `802ed694b8887b88`.
4. `markup, startup ordering and accessibility remain pinned`
5. `default COVERAGE refresh materializes the active and visible camera frustums`
6. `real active monitor plane owns one protected host label and no native label entity`

(2)–(4) are frozen-baseline guards the Ghost author never re-derived after editing; the affected voice subsystem is disabled keylessly anyway. **Not patched** — the baseline rule is a pristine donor, and the task forbids editing tests to turn them green.

### The 6 track-regression failures — upstream, not code

All six are `display-floor/corridor` checks reporting `floor = null` / `0.0 m`. Cause is visible in the server log: `[terrain-heights-proxy] refresh incomplete (The operation was aborted due to timeout) — serving stale points when available`. The app requests `/api/terrain/heights` with a **single URL carrying hundreds of coordinate pairs**; that bulk refresh intermittently times out, so corridor ground-warming has no mesh to sample. The endpoint itself is healthy (`terrain.reearth.land/heights.json` → HTTP 200 in 0.17s), so this is upstream latency under bulk load, not a code failure.

### Map-source-tray QA

The script asserts the **upstream four-source tray** `["photoreal","bing-aerial","bing-labels","osm"]` — it has not been updated for the fork's added `esri-aerial`, the same class of defect as (1) above. Its own diagnostics show the *app* behaving correctly: active stack `esri-aerial`, `"Bing Aerial unavailable: Cesium ion token required for Bing stacks"`, and an OSM switch committing to `status: "OSM", active: ["osm"]`. It then aborted on a Puppeteer `Node is either not clickable or not an Element` at `scripts/qa-map-source-tray.mjs:547`, so the remaining checks did not run.

## 8. Service, binding, and keyless configuration

Launched via the repository-supported **dev** path (not `preview`), as required:

```
npm run dev -- --host localhost --port 4173
```

| Field | Value |
|---|---|
| URL | **http://localhost:4173** |
| Listening interface | **`::1:4173` — loopback only** |
| HTTP | **200** (55,119 bytes) |
| LAN reachability | **Not reachable** from the host's LAN IP 192.168.56.1 — verified, connection refused |
| Firewall | Unchanged. No inbound rule added. |

`.env` (gitignored, no keys, no secrets):

```
HOST=localhost
PORT=4173
OPENSKY_AUTH_MODE=anon
```

Note: `HOST` is not read by this app (it is absent from `.env.example`); the loopback bind is actually enforced by the `--host localhost` CLI flag. It is recorded here because the task doc specified it.

**No optional key of any kind was configured.** No secret value appears in this report, the logs, or the screenshots.

## 9. Keyless layer verification

Probed through the app's own proxies on localhost:4173 while it ran keyless.

| Layer | Route | Result |
|---|---|---|
| Civil aircraft | `/api/opensky` | **200 — live.** Real states, e.g. `50047c / T7AKR20 / San Marino` |
| Military aircraft | `/api/adsblol/mil` | **200 — live.** Real contacts, e.g. hex `ae5ded`, type `C30J` |
| Vessels (keyless AIS) | `/api/ais-live` | **200 — live.** Real rows, e.g. `ELBWIND`, MMSI `210017000`. Open Waters, no AISStream key |
| Satellites | `/api/celestrak/stations` | **200 — live.** Real TLE, `ISS (ZARYA)` NORAD 25544 |
| Earthquakes | USGS (direct) | **200 — live.** 4 features in the last hour |
| CCTV | server log | **live.** TfL JamCam 796, Caltrans 1821 in-service, Austin 817; catalog 1050 capped to 900 |
| Rocket launches | `/api/launches` | **200 — live.** 27 upcoming |
| **FIRMS** | `/api/firms` | **503 `{"error":"no_key"}`** — explicit key-required, **not fabricated**. Correct. |
| **Google 3D** | UI | `aria-disabled`, *"Google 3D unavailable: Google 3D is unavailable"*. Correct. |
| **Bing / ion** | UI | *"Bing Aerial unavailable: Cesium ion token required for Bing stacks"* (same for Labels). Correct. |
| **OpenAI voice** | UI + console | Mic reads **OFF / VOICE STANDBY**; console warns `[HUD] AI summary unavailable: Error: OPENAI_API_KEY is not set`. Degrades cleanly; rest of app works. Correct. |
| Traffic (TomTom) | — | Not confirmed. `/api/tomtom` needs a subroute; my probe returned `404 {"error":"not_found"}`, which is my probe's fault, not evidence of a defect. **Simulated-traffic labelling was not verified.** |

Startup selected **`esri-aerial`** automatically with no Google key — `map=esri-aerial` in the URL hash — exactly the keyless fallback the task doc describes. Ghost Edition branding and controls load; title is `Gods Eye — GHOST EDITION`.

Degraded but honest: `[Data] military refresh error: Error: adsb.lol HTTP 420` under repeated QA polling — upstream rate-limiting ("Enhance Your Calm"), which the UI surfaces as `LOAD FAILED · LIVE FLIGHTS`. Direct probe of adsb.lol returns 200, so the feed is healthy; only sustained polling trips it.

### ❌ FAILING acceptance criterion — the keyless globe renders no imagery

**"A keyless globe renders in a real WebGL browser" is NOT met.**

In real Chrome 151 on the **real GPU** (GTX 1080 Ti / D3D11, WebGL2 = true), the UI, HUD, panels, MGRS readout and all data layers render correctly — but the globe surface is black. The page's own resource timeline is unambiguous:

| Metric | esri-aerial | osm |
|---|---|---|
| Total resources | 212 | 221 |
| `arcgisonline` imagery tiles | **0** | **0** |
| `tile.openstreetmap` tiles | **0** | **0** |
| `terrain.reearth` **.terrain** tiles | **0** | **0** |
| `terrain.reearth/layer.json` | 1 | 1 |

Terrain `layer.json` is fetched once, then **not one terrain or imagery tile is ever requested, on any stack.**

Ruled out:
- **Not network.** `server.arcgisonline.com` (the exact URL the app uses, `mapStackController.js:277`) → HTTP 200, 13,037 bytes; `services.arcgisonline.com` → 200; `tile.openstreetmap.org` → 200; `terrain.reearth.land/.../layer.json` → 200 and `0/0/0.terrain` → 200, 75,134 bytes. A `fetch` for an Esri tile **from inside the page** returned `200 image/jpeg`.
- **Not GPU/WebGL.** Real hardware D3D11 context, WebGL2 available.
- **Not an exception.** Console shows only the expected `OPENAI_API_KEY is not set` and `adsb.lol HTTP 420` warnings — no imagery/provider/Cesium error.
- **Not stack-specific.** Identical on `esri-aerial` and `osm`.
- **Not idle-render throttling.** The fork's `renderGovernor` flips the scene into Cesium `requestRenderMode` when idle, which would gate tile loading — but a click-drag on the globe still produced **0** tiles, so this hypothesis did not hold.

The root cause is **not** established. It is reproducible and it is in the donor as shipped, not in this installation. **Per the baseline rule the donor was left untouched** — no source edit was attempted. Any fix belongs on a separate branch with a documented diff.

## 10. Launch scripts

Created **outside** the donor checkout, in `G:\tommy\deploy\gods-eye-ghost\`:

| Script | Purpose |
|---|---|
| `ghost-env.ps1` | Shared paths/env; prepends portable Node to PATH; pins caches to `G:` |
| `start-ghost.ps1` | Starts dev server on `localhost:4173`, timestamped stdout/stderr logs, writes PID, polls for HTTP 200. **Refuses to start a duplicate** if 4173 is already held |
| `stop-ghost.ps1` | Stops the port owner and the wrapper, clears the PID file |
| `status-ghost.ps1` | Reports PID, bound interface, HTTP status; **warns loudly if bound beyond loopback** |

Primary entry point (user-authored, repaired here): **`G:\tommy\Start-Ghost.bat`** — starts the server, polls until it truly answers HTTP 200, then launches Chrome in **kiosk mode** (`--kiosk --new-window`) under a dedicated profile at `G:\tommy\cache\chrome-app-profile`. Safe to run twice: it never starts a duplicate server.

Kiosk verified by measurement, not appearance: window rect **1920×1080 at (0,0)** against a 1920×1080 screen, with `WS_CAPTION` and `WS_THICKFRAME` both false — no title bar, no frame. Exit with Alt+F4; Alt+Tab switches away. Set `KIOSK=0` at the top of the file for a windowed app-mode frame instead.

The dedicated Chrome profile is load-bearing: without `--user-data-dir`, launching while the user's everyday Chrome is running makes Chrome forward the URL to that instance and **`--kiosk` is silently ignored**, yielding an ordinary tab.

Verified live: `status-ghost.ps1` → `LISTENING on ::1:4173 (PID 16468 node)`, `HTTP : 200`. Duplicate-start → `REFUSING TO START: port 4173 is already in use by PID 16468 (node).`, exit 1.

No PM2/NSSM/Docker installed. No Task Scheduler autostart configured — that needs your explicit go-ahead.

## 11. Deviations from the task document

1. **Node installed as portable ZIP, not an installer.** The session holds no admin rights and the task forbids crossing an elevation boundary unannounced. The ZIP needs no elevation and changes nothing system-wide. Checksum verified against nodejs.org.
2. **Archive SHA-256 not verified** — the supplied `Gods-Eye-Ghost-Edition-main.zip` is not on this server. Cloned from GitHub; HEAD matches the doc's recorded SHA exactly.
3. **`core.autocrlf=false` set repo-locally** and the tree re-checked-out. This *restores* pristine upstream bytes; it is not a content edit. Global/system git config untouched.
4. **`HOST` kept in `.env`** though this app does not read it, because the doc specified it. Loopback binding is enforced by the CLI flag.
5. **A QA harness was written** at `qa/smoke.mjs` — outside the donor, in the deployment directory, per Phase 3.
6. **`npm audit fix` deliberately not run** (§5).
7. **Traffic/TomTom simulated-state labelling not verified** (§9).

## 12. Acceptance criteria

| # | Criterion | Status |
|---|---|---|
| 1 | Clean donor checkout, separate from upstream GEV | ✅ |
| 2 | Exact provenance recorded | ✅ SHA `2c4de78…` |
| 3 | Node meets real lockfile floor ≥20.19 | ✅ 22.23.2 |
| 4 | Reproducible `npm ci`, no undocumented flags | ✅ |
| 5 | `npm run build` succeeds | ✅ |
| 6 | `npm test` succeeds, or env defect fixed | ⚠️ Env defect found and fixed (30→6). 6 pre-existing fork failures remain, documented |
| 7 | Browser QA attempted, recorded honestly | ✅ |
| 8 | Runs at localhost:4173 with no API keys | ✅ |
| 9 | **Keyless globe renders in a real WebGL browser** | ❌ **FAIL** — §9 |
| 10 | Aircraft / vessel / quake / satellite verified | ✅ all live keylessly |
| 11 | Missing keys → explicit unavailable/disabled, not fatal | ✅ |
| 12 | Not exposed beyond localhost | ✅ verified refused from LAN IP |
| 13 | Complete INSTALL_REPORT.md | ✅ this file |
| 14 | No Tommy code merged | ✅ donor clean at HEAD |

## 13. Open items for the user

1. **Blocking for real use — the keyless globe shows no map imagery** (§9). Reproducible, root cause not established, donor deliberately left unpatched. Decide whether to fix on a branch or raise it with the Ghost author.
2. **9 high-severity npm advisories** unpatched to preserve the lockfile (§5).
3. **6 pre-existing fork test failures**, including a genuine `esri-aerial` cable-classification gap on the keyless default stack (§7).
4. Autostart-after-reboot, LAN exposure, and any API keys all remain **not configured** and need your explicit instruction.

## 14. Disk footprint

| Path | Size |
|---|---|
| `G:\tommy\tools\node` | 100 MB |
| `G:\tommy\donors\gods-eye-ghost` | 455 MB |
| `G:\tommy\cache` | 722 MB |
| `G:\tommy\deploy` | 3 MB |

G: free after install: ~77 GB.
