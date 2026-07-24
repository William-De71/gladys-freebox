# gladys-freebox

External [Gladys Assistant](https://gladysassistant.com) integration to control your **Freebox** (home automation devices, players and cameras) over the local network.

Built on the [Gladys integration SDK](https://github.com/GladysAssistant/integration-sdk-js), from the [official template](https://github.com/GladysAssistant/integration-template-js).

## What it does

| Freebox object                            | Gladys support                                 |
| ----------------------------------------- | ---------------------------------------------- |
| Opening / motion sensors                  | Read-only binary sensors                       |
| Battery                                   | Battery level (%)                              |
| Roller shutters (`store`, `store_slider`) | Shutter state + position                       |
| Players (set-top boxes)                   | Power (read-only), volume, mute, media control |
| Cameras                                   | On-demand image (ffmpeg capture of the stream) |

## Architecture

```
index.js                     SDK wiring: handlers + manifest actions
src/devices.js               discovery / poll / setValue / getImage orchestration
src/freebox/
  FreeboxClient.js           discovery, pairing, session, authenticated requests
  httpClient.js              native HTTPS client trusting the Freebox Root CA
  constants.js               app identity, endpoints, Freebox Root CA
  convert.js                 Freebox -> Gladys device/feature conversion
  deviceMapping.js           function <-> feature mapping + value transforms
  camera.js                  ffmpeg snapshot capture
```

## Pairing model

The Freebox app token is obtained through the **"Pair with the Freebox"** manifest action (the user confirms on the box LCD screen) and persisted through `gladys.setConfig()` under a key that is **not** declared in the `config_schema`. It is reloaded on every connection. Two more actions are exposed: **Test the connection** and **Unpair**.

## Local development

```bash
npm install
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="freebox" \
npm start
```

```bash
npm test          # unit tests (node --test)
npm run lint      # eslint
npm run format    # prettier
```

## License

Apache-2.0
