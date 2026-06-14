# Screen-sharing channel (mediasoup SFU)

Sync Party has a single app-wide screen-sharing channel: one person
streams their screen, everyone who opens the channel watches. It runs
on the same single Node process via an embedded
[mediasoup](https://mediasoup.org/) SFU — the streamer uploads once and
the server fans the stream out to each viewer, so the streamer's upload
cost does not grow with the number of viewers.

It's reached from the dashboard via the **Screen share** button (a
dedicated `/screenshare` page), independent of the watch parties. Only
one streamer is allowed at a time; while someone is streaming, the
button reads "Someone else is sharing" for everyone else.

## How it fits together

- **Server:** `src/server/streaming/sfu.ts` owns the mediasoup workers,
  one `Router` per channel (VP8 + Opus), and the per-user transports /
  producers / consumers. Signaling rides the existing socket.io
  connection under the `streaming:` event namespace (see
  `src/server/server.ts`). The global channel id is
  `GLOBAL_STREAM_CHANNEL` (`src/shared/types.ts`); any authenticated
  user may join it. (The SFU stays generic — a channel id can also be a
  party id, gated on real party membership — but the UI only exposes the
  single global channel.)
- **ICE:** `GET /api/iceServers` returns the STUN/TURN list, built by
  `src/server/streaming/iceServers.ts`.
- **Client:** `src/client/src/common/useStreamingChannel.ts` is the
  mediasoup-client hook (device, send/recv transports, produce,
  consume). `ScreenScreenShare.tsx` is the dedicated `/screenshare`
  page.

## Required setup on the host

mediasoup needs a UDP/TCP port range open for RTP, and for the stream
to work across the public internet (different NATs) you want a TURN
server. Both are operational, one-time setup on the box that runs Sync
Party.

### 1. Open the mediasoup RTC port range

mediasoup binds media transports to a UDP/TCP port range (default
`40000-49999`). Open that range on your firewall / security group, both
UDP and TCP.

### 2. Tell mediasoup its public IP

When the server is behind NAT (most cloud VMs), mediasoup must announce
the *public* IP in its ICE candidates, or remote peers can't reach it:

```
MEDIASOUP_ANNOUNCED_IP=<your.server.public.ip>
```

(Leave unset for a purely LAN deployment.)

### 3. Install + configure coturn

```
sudo apt-get install coturn
```

Enable it (`/etc/default/coturn`):

```
TURNSERVER_ENABLED=1
```

Minimal `/etc/turnserver.conf` using the shared-secret scheme that the
app already implements:

```
listening-port=3478
fingerprint
use-auth-secret
static-auth-secret=<a-long-random-secret>
realm=<your.domain>
# the public IP coturn hands out
external-ip=<your.server.public.ip>
# lock it down a bit
no-multicast-peers
no-cli
```

Restart: `sudo systemctl restart coturn`.

### 4. Point Sync Party at coturn

```
TURN_URLS=turn:<your.domain>:3478
TURN_AUTH_SECRET=<the same static-auth-secret as above>
# optional, defaults shown
TURN_CRED_TTL=3600
STUN_URLS=stun:stun.l.google.com:19302
```

The server issues short-lived TURN credentials per request using
coturn's `use-auth-secret` HMAC scheme — no per-user accounts in
coturn.

## All env vars

| Var | Default | Purpose |
|-----|---------|---------|
| `MEDIASOUP_WORKERS` | `min(2, #CPUs)` | number of mediasoup workers |
| `MEDIASOUP_RTC_MIN_PORT` | `40000` | RTC port range start |
| `MEDIASOUP_RTC_MAX_PORT` | `49999` | RTC port range end |
| `MEDIASOUP_LISTEN_IP` | `0.0.0.0` | bind IP for transports |
| `MEDIASOUP_ANNOUNCED_IP` | _(unset)_ | public IP in ICE candidates |
| `STUN_URLS` | `stun:stun.l.google.com:19302` | comma-separated STUN URLs |
| `TURN_URLS` | _(unset)_ | comma-separated TURN URLs |
| `TURN_AUTH_SECRET` | _(unset)_ | coturn `static-auth-secret` |
| `TURN_CRED_TTL` | `3600` | TURN credential lifetime (s) |

Without `TURN_URLS`, the app runs STUN-only: fine on most home
networks, but a minority of viewer connections behind strict NATs will
fail to connect. Add coturn when that becomes a problem.

## Browser notes

- Screen capture uses `getDisplayMedia`. Chromium can capture tab/window
  audio; **Firefox cannot capture system/tab audio**, so a Firefox
  streamer shares video only.
- Stopping via the browser's own "Stop sharing" bar releases the
  streamer slot automatically.
