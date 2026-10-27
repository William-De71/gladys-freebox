// -----------------------------------------------------------------------------
// Freebox constants: application identity, endpoints and the Freebox Root CA.
// -----------------------------------------------------------------------------

// Local URL of the Freebox Server. Reachable on the LAN, always over HTTPS with
// the Freebox self-signed certificate (see FREEBOX_CA_CERTS below).
export const FREEBOX_LOCAL_URL = 'https://mafreebox.freebox.fr';

// Application identity declared to the Freebox during pairing. `app_id` MUST be
// stable across versions: it is the key the Freebox uses to remember the grant.
export const APP_IDENTITY = {
  app_id: 'fr.freebox.gladysassistant',
  app_name: 'Gladys Assistant',
  app_version: 'v1.0.0',
  device_name: 'Gladys Integration',
};

// Config key (NOT declared in config_schema) used to persist the app token
// returned by the Freebox after a successful pairing. Stored through
// gladys.setConfig(), reloaded through gladys.getConfig() on every connection.
export const APP_TOKEN_CONFIG_KEY = 'app_token';

// Config key (NOT declared in config_schema either) keeping when the reboot
// scene action last rebooted the box, in ms: its minimum interval survives a
// restart of the integration.
export const LAST_SCENE_REBOOT_CONFIG_KEY = 'last_scene_reboot_at';

// Freebox Player (set-top box) constants. Players expose their own API,
// versioned independently: /player/{id}/api/{version}/...
export const PLAYER = {
  // Second segment of the external_id ("freebox:player:{id}"),
  // used to tell player devices apart from home automation nodes.
  EXTERNAL_ID_SEGMENT: 'player',
  API_VERSION_PARAM: 'PLAYER_API_VERSION',
  DEFAULT_API_VERSION: 'v6',
  MODEL: 'player',
  // Fallback name when the Freebox does not advertise a device_name: `name` is
  // NOT NULL in Gladys, an unnamed device cannot be created.
  DEFAULT_NAME: 'Freebox Player',
};

// The Freebox Server itself, published as one device carrying the state of
// the internet connection (`/connection/`, readable by every app: reading the
// settings needs no permission).
export const SERVER = {
  // Second segment of the external_id ("freebox:server"): never a number, so
  // it cannot meet a home-automation node id, nor the player segment.
  EXTERNAL_ID_SEGMENT: 'server',
  MODEL: 'server',
  NAME: 'Freebox Server',
  // Feature keys (third segment of the external id) added in 1.4.0: the Wi-Fi
  // switch, and one temperature per sensor the box lists ("temp-<sensor id>").
  WIFI_KEY: 'wifi',
  SENSOR_PREFIX: 'temp-',
};

// HTTPS access to the Freebox: https://dev.freebox.fr/sdk/os/#https-access
// The Freebox serves a certificate issued by Free's own authorities. Older
// boxes chain to the RSA "Freebox Root CA"; recent ones (Delta, Pop, Ultra)
// to the "Freebox ECC Root CA" through an intermediate they send along. Both
// are trusted, so the connection is verified whatever the model.
const FREEBOX_RSA_ROOT_CA = `-----BEGIN CERTIFICATE-----
MIIFmjCCA4KgAwIBAgIJAKLyz15lYOrYMA0GCSqGSIb3DQEBCwUAMFoxCzAJBgNV
BAYTAkZSMQ8wDQYDVQQIDAZGcmFuY2UxDjAMBgNVBAcMBVBhcmlzMRAwDgYDVQQK
DAdGcmVlYm94MRgwFgYDVQQDDA9GcmVlYm94IFJvb3QgQ0EwHhcNMTUwNzMwMTUw
OTIwWhcNMzUwNzI1MTUwOTIwWjBaMQswCQYDVQQGEwJGUjEPMA0GA1UECAwGRnJh
bmNlMQ4wDAYDVQQHDAVQYXJpczEQMA4GA1UECgwHRnJlZWJveDEYMBYGA1UEAwwP
RnJlZWJveCBSb290IENBMIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEA
xqYIvq8538SH6BJ99jDlOPoyDBrlwKEp879oYplicTC2/p0X66R/ft0en1uSQadC
sL/JTyfgyJAgI1Dq2Y5EYVT/7G6GBtVH6Bxa713mM+I/v0JlTGFalgMqamMuIRDQ
tdyvqEIs8DcfGB/1l2A8UhKOFbHQsMcigxOe9ZodMhtVNn0mUyG+9Zgu1e/YMhsS
iG4Kqap6TGtk80yruS1mMWVSgLOq9F5BGD4rlNlWLo0C3R10mFCpqvsFU+g4kYoA
dTxaIpi1pgng3CGLE0FXgwstJz8RBaZObYEslEYKDzmer5zrU1pVHiwkjsgwbnuy
WtM1Xry3Jxc7N/i1rxFmN/4l/Tcb1F7x4yVZmrzbQVptKSmyTEvPvpzqzdxVWuYi
qIFSe/njl8dX9v5hjbMo4CeLuXIRE4nSq2A7GBm4j9Zb6/l2WIBpnCKtwUVlroKw
NBgB6zHg5WI9nWGuy3ozpP4zyxqXhaTgrQcDDIG/SQS1GOXKGdkCcSa+VkJ0jTf5
od7PxBn9/TuN0yYdgQK3YDjD9F9+CLp8QZK1bnPdVGywPfL1iztngF9J6JohTyL/
VMvpWfS/X6R4Y3p8/eSio4BNuPvm9r0xp6IMpW92V8SYL0N6TQQxzZYgkLV7TbQI
Hw6v64yMbbF0YS9VjS0sFpZcFERVQiodRu7nYNC1jy8CAwEAAaNjMGEwHQYDVR0O
BBYEFD2erMkECujilR0BuER09FdsYIebMB8GA1UdIwQYMBaAFD2erMkECujilR0B
uER09FdsYIebMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgGGMA0GCSqG
SIb3DQEBCwUAA4ICAQAZ2Nx8mWIWckNY8X2t/ymmCbcKxGw8Hn3BfTDcUWQ7GLRf
MGzTqxGSLBQ5tENaclbtTpNrqPv2k6LY0VjfrKoTSS8JfXkm6+FUtyXpsGK8MrLL
hZ/YdADTfbbWOjjD0VaPUoglvo2N4n7rOuRxVYIij11fL/wl3OUZ7GHLgL3qXSz0
+RGW+1oZo8HQ7pb6RwLfv42Gf+2gyNBckM7VVh9R19UkLCsHFqhFBbUmqwJgNA2/
3twgV6Y26qlyHXXODUfV3arLCwFoNB+IIrde1E/JoOry9oKvF8DZTo/Qm6o2KsdZ
dxs/YcIUsCvKX8WCKtH6la/kFCUcXIb8f1u+Y4pjj3PBmKI/1+Rs9GqB0kt1otyx
Q6bqxqBSgsrkuhCfRxwjbfBgmXjIZ/a4muY5uMI0gbl9zbMFEJHDojhH6TUB5qd0
JJlI61gldaT5Ci1aLbvVcJtdeGhElf7pOE9JrXINpP3NOJJaUSueAvxyj/WWoo0v
4KO7njox8F6jCHALNDLdTsX0FTGmUZ/s/QfJry3VNwyjCyWDy1ra4KWoqt6U7SzM
d5jENIZChM8TnDXJzqc+mu00cI3icn9bV9flYCXLTIsprB21wVSMh0XeBGylKxeB
S27oDfFq04XSox7JM9HdTt2hLK96x1T7FpFrBTnALzb7vHv9MhXqAT90fPR/8A==
-----END CERTIFICATE-----`;

const FREEBOX_ECC_ROOT_CA = `-----BEGIN CERTIFICATE-----
MIICWTCCAd+gAwIBAgIJAMaRcLnIgyukMAoGCCqGSM49BAMCMGExCzAJBgNVBAYT
AkZSMQ8wDQYDVQQIDAZGcmFuY2UxDjAMBgNVBAcMBVBhcmlzMRMwEQYDVQQKDApG
cmVlYm94IFNBMRwwGgYDVQQDDBNGcmVlYm94IEVDQyBSb290IENBMB4XDTE1MDkw
MTE4MDIwN1oXDTM1MDgyNzE4MDIwN1owYTELMAkGA1UEBhMCRlIxDzANBgNVBAgM
BkZyYW5jZTEOMAwGA1UEBwwFUGFyaXMxEzARBgNVBAoMCkZyZWVib3ggU0ExHDAa
BgNVBAMME0ZyZWVib3ggRUNDIFJvb3QgQ0EwdjAQBgcqhkjOPQIBBgUrgQQAIgNi
AASCjD6ZKn5ko6cU5Vxh8GA1KqRi6p2GQzndxHtuUmwY8RvBbhZ0GIL7bQ4f08ae
JOv0ycWjEW0fyOnAw6AYdsN6y1eNvH2DVfoXQyGoCSvXQNAUxla+sJuLGICRYiZz
mnijYzBhMB0GA1UdDgQWBBTIB3c2GlbV6EIh2ErEMJvFxMz/QTAfBgNVHSMEGDAW
gBTIB3c2GlbV6EIh2ErEMJvFxMz/QTAPBgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB
/wQEAwIBhjAKBggqhkjOPQQDAgNoADBlAjA8tzEMRVX8vrFuOGDhvZr7OSJjbBr8
gl2I70LeVNGEXZsAThUkqj5Rg9bV8xw3aSMCMQCDjB5CgsLH8EdZmiksdBRRKM2r
vxo6c0dSSNrr7dDN+m2/dRvgoIpGL2GauOGqDFY=
-----END CERTIFICATE-----`;

export const FREEBOX_CA_CERTS = [FREEBOX_RSA_ROOT_CA, FREEBOX_ECC_ROOT_CA];
