# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** of type `device`: it brings a
[Freebox](https://www.free.fr/freebox/) into Gladys over the **local network
only** (the Freebox OS API on `mafreebox.freebox.fr`, no Free account, no
cloud): home automation (opening and motion sensors, tamper contacts,
batteries, roller shutters, alarm panel and keyfob), Freebox Players (power,
volume, channels, media, remote keys), cameras (ffmpeg snapshots of the HLS
stream), the internet connection of the box (state, download and upload
rates), its Wi-Fi switch and temperature sensors, three dashboard widgets
(box, calls, network), two scene triggers (phone call, network device
presence) and a Wake-on-LAN scene action. A Node.js service (Node 22+,
ESM, no build step) that runs in its own sandboxed Docker container and talks
to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/convert.test.js          # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store . --skip-image-check   # store checks
docs/illustrations/render.sh              # docs/assets/widgets.<lang>.png
node .github/scripts/release.mjs plan     # the version the next release would get
```

## Architecture

```
index.js                     SDK wiring: handlers, manifest actions, lifecycle
src/devices.js               discovery / poll / setValue / camera push
src/externalId.js            `ext:<selector>:` prefix, added and stripped
src/messages.js              messages of the manifest actions, in en / fr / de / es
src/i18n.js                  widget texts and toasts, in en / fr / de / es
src/watcher.js               30 s loop: LAN hosts and call log snapshots
src/tracker.js               snapshots -> trigger transitions (pure logic)
src/events.js                scene trigger payloads, Wake-on-LAN fields
src/widgets.js               box, calls and network widget contents (pure)
src/freebox/FreeboxClient.js discovery, pairing, shared session, requests
src/freebox/httpClient.js    native HTTPS client, verified against Free's CAs
src/freebox/constants.js     app identity, endpoints, Free's root CAs
src/freebox/convert.js       Freebox -> Gladys device/feature conversion
src/freebox/read.js          system, LAN hosts, calls, RRD -> plain snapshots
src/freebox/deviceMapping.js function <-> feature mapping + value transforms
src/freebox/camera.js        ffmpeg snapshot capture
scripts/diagnose-realtime.js standalone probe of the box (not in the image)
gladys-assistant-integration.json   manifest
docs/{en,fr,de,es}.md        user documentation, re-hosted by the store
docs/illustrations/          generated widget images (render.sh, gen.mjs, render.js)
.github/scripts/release.mjs  version, changelog, bump (tested in test/)
```

## Rules

- **Ids and selectors are forever**: the device and feature external ids
  (`freebox:{node}`, `freebox:{node}:{endpoint}`, `freebox:player:{id}`,
  `freebox:player:{id}:{type}`,
  `freebox:server:{connection|rate-down|rate-up|wifi|temp-<sensor id>}`,
  prefixed with `ext:<selector>:` only at the
  edge by `src/externalId.js`), the device and feature selectors (scenes point
  at them), and for each feature its `category`, `type`, `unit`, `min`, `max`,
  `read_only`, `has_feedback`; the device params (`CAMERA_URL`,
  `PLAYER_API_VERSION`); the keys of `config_schema` and of the actions; the
  `app_id` of the pairing (`APP_IDENTITY`) and the config key of the app token;
  the keys of the widgets and their settings, of the scene triggers (fields,
  options, variables) and of the scene action (fields).
  `test/structure.test.js` compares them to
  `test/fixtures/discovery.baseline.json` (version 1.2.0): devices and
  features may be added, none may change or disappear. Never update the
  baseline to make a test pass without a documented migration.
- **`should_poll` / `poll_frequency`** (milliseconds, one of
  `DEVICE_POLL_FREQUENCIES`) are never resynchronized on a device already
  created.
- **States.** Publish through `publishChangedStates` (300 states per minute per
  integration, and an unchanged value must not be sent again). States sent
  before a device is created are dropped: `onDeviceCreated` reads the new
  device at once (`refreshCreatedDevice`).
- **Poll acknowledgement.** The core waits 5 seconds for `onPoll`: never
  capture a camera image there (ffmpeg takes longer); the camera push loop and
  `onGetImage` do it.
- **Scene triggers.** The first reading of the watch loop is a baseline: a
  restart never replays the call log nor announces every host as connected.
  Trigger data stays raw (`missed`, `connected`): the core sends no language
  with an event. No trigger reports what Gladys did itself (the Wi-Fi switch
  has none), but turning the Wi-Fi off does make the Wi-Fi hosts leave.
- **Permissions.** Reading the settings, the system state, the Wi-Fi state
  and the LAN hosts is open to every paired app; switching the Wi-Fi and
  rebooting need "Freebox settings modification", the call log needs "Call
  log access". A refusal (`insufficient_rights`) is turned into a message that
  names the permission, never a generic error.
- **Widget images.** After any change to the content of a widget, run
  `docs/illustrations/render.sh` again and look at the four PNG files. The
  front shows a list item's `date` in place of its `subtitle`.
- **Undocumented endpoints.** `control/remote` of the Player is reverse
  engineered: keep it best-effort and say so in the docs. Never invent an
  endpoint; the reference is https://dev.freebox.fr/sdk/os/.
- **The container rootfs is read-only.** Write only under `/data` (nothing is
  written today); captures go through pipes, never temporary files.
- **Gladys version.** Widgets and scene declarations need `gladys_version`
  `>=5.1.0`; a widget button with `fields` (a form) would need 5.2.0.
- **Four languages.** Every user-facing text (manifest, action results,
  `docs/*.md`, README) exists in English, French, German and Spanish, with the
  vocabulary of the Gladys interface. `test/i18n.test.js` and
  `test/messages.test.js` check it. Feature names stay as the Freebox labels
  them (French) or English: the user renames devices freely.
- **Versions belong to the Release workflow**: never edit `version` in
  `package.json`, the lockfile or the manifest, nor the `docker_image` tag.
- **Changelog.** Never edit CHANGELOG.md by hand, it is generated at the
  release. Write the PR title as the line the user will read.
- **Commits and PR titles** follow Conventional Commits, in English: `feat` ->
  minor, `fix` / `perf` -> patch, `!` or `BREAKING CHANGE:` -> major (minor
  below 1.0.0); `docs`, `chore`, `ci`, `test`, `style`, `refactor`, `build`
  release nothing. Scope `security` lands under "Security", a description
  starting with "remove" / "drop" under "Removed".
- **Manifest.** Texts are objects `{ "en", "fr", "de", "es" }`; the catalog
  `description` holds 10 to 100 characters per language, the whole file stays
  under the 100 KB of the store. A feature type or a field older cores do not
  know needs a higher `gladys_version` minimum (see `src/constants.js` of the
  integration-store).
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network or a real Freebox.
