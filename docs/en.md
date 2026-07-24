# Freebox integration

This integration lets you control your **Freebox** from Gladys Assistant, directly over your local network, with no cloud involved.

## Features

- **Freebox home automation**: opening sensors, motion sensors, battery level, roller shutters (state and position).
- **Freebox Players** (compatible models, see below): power state (read-only), volume, mute, and media control (play, pause, stop, previous, next, rewind and fast forward).
- **Freebox cameras**: image shown on the dashboard (refreshed automatically) and on demand, captured from the video stream with ffmpeg.
- **Actions**: pair, test the connection, reboot the Freebox and unpair, right from the configuration screen.

## Requirements

- A Freebox (Delta, Ultra, Pop, Revolution...) with the home automation server enabled.
- Gladys Assistant and this integration must run on the **same local network** as the Freebox (access to `mafreebox.freebox.fr`).

## Pairing

1. Open the Freebox integration configuration screen in Gladys.
2. Click the **"Pair with the Freebox"** button.
3. Walk to your Freebox Server: its LCD screen shows an authorization request. Press the **right arrow** to confirm.
4. The pairing is remembered: you only need to do it once.

## Permissions to enable (important)

After pairing, open your Freebox settings:

**Freebox OS > Settings > Access management > Applications > Gladys Assistant**

and **enable** the following permissions:

- **Home automation and alarm management** (sensors, shutters)
- **Camera access**
- **Freebox Player control**

⚠️ Without these boxes ticked, the matching devices will **not appear** during discovery. This is the most common cause of a missing device.

Once the permissions are granted, run a device scan: Gladys will list every device detected on your Freebox. Pick the ones you want to create.

## Freebox Player POP / Android TV limitation

**Freebox Player POP** units (and other **Android TV**-based players) are **not controllable** through this integration: Free does not expose the local control API on those models (the player is reported with `api_available: false` and is therefore skipped). To control a Player POP, use an **Android TV** integration (ADB protocol), which is out of scope here.

The Players of the **Delta** and **Revolution** Freebox (which expose the local player API) remain fully controllable.

## Rebooting the Freebox

The **"Reboot the Freebox"** action on the configuration screen restarts your Freebox Server. There is no shutdown action: the Freebox API only exposes a reboot (a powered-off box could not be turned back on remotely).
