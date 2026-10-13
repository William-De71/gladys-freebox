# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** of type `device`: it brings a
[Freebox](https://www.free.fr/freebox/) into Gladys over the **local network
only** (the Freebox OS API on `mafreebox.freebox.fr`, no Free account, no
cloud): home automation (opening and motion sensors, tamper contacts,
batteries, roller shutters, alarm panel and keyfob), Freebox Players (power,
volume, channels, media, remote keys) and cameras (ffmpeg snapshots of the
HLS stream). A Node.js service (Node 22+,
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
node .github/scripts/release.mjs plan     # the version the next release would get
```

## Architecture

```
index.js                     SDK wiring: handlers, manifest actions, lifecycle
src/devices.js               discovery / poll / setValue / camera push
src/externalId.js            `ext:<selector>:` prefix, added and stripped
src/messages.js              user-facing messages, in en / fr / de / es
src/freebox/FreeboxClient.js discovery, pairing, shared session, requests
src/freebox/httpClient.js    native HTTPS client, verified against Free's CAs
src/freebox/constants.js     app identity, endpoints, Free's root CAs
src/freebox/convert.js       Freebox -> Gladys device/feature conversion
src/freebox/deviceMapping.js function <-> feature mapping + value transforms
src/freebox/camera.js        ffmpeg snapshot capture
scripts/diagnose-realtime.js standalone probe of the box (not in the image)
gladys-assistant-integration.json   manifest
docs/{en,fr,de,es}.md        user documentation, re-hosted by the store
.github/scripts/release.mjs  version, changelog, bump (tested in test/)
```

## Rules

- **Ids and selectors are forever**: the device and feature external ids
  (`freebox:{node}`, `freebox:{node}:{endpoint}`, `freebox:player:{id}`,
  `freebox:player:{id}:{type}`, prefixed with `ext:<selector>:` only at the
  edge by `src/externalId.js`), the device and feature selectors (scenes point
  at them), and for each feature its `category`, `type`, `unit`, `min`, `max`,
  `read_only`, `has_feedback`; the device params (`CAMERA_URL`,
  `PLAYER_API_VERSION`); the keys of `config_schema` and of the actions; the
  `app_id` of the pairing (`APP_IDENTITY`) and the config key of the app token.
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
- **Undocumented endpoints.** `control/remote` of the Player is reverse
  engineered: keep it best-effort and say so in the docs. Never invent an
  endpoint; the reference is https://dev.freebox.fr/sdk/os/.
- **The container rootfs is read-only.** Write only under `/data` (nothing is
  written today); captures go through pipes, never temporary files.
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
