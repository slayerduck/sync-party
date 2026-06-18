# OBS stream channel (WHIP → mediasoup)

Sync Party has a second app-wide live channel — like the screen-share
channel, but the single streamer publishes from **OBS** instead of a
browser. One person streams, everyone who opens the channel watches.
Reached from the dashboard via the **OBS stream** button (a dedicated
`/obs` page).

It reuses the same embedded [mediasoup](https://mediasoup.org/) SFU and
the exact same viewer playback + connection diagnostics as screen share.
The only new piece is a **WHIP** ingest endpoint that turns OBS's WebRTC
offer into mediasoup producers.

## How it fits together

- **Ingest:** OBS (version **30+**) uses its built-in **WHIP** output to
  POST an SDP offer to `POST /api/whip` with a bearer token. The server
  (`src/server/streaming/whip.ts` + `streaming/sfu.ts#ingestWhip`) parses
  the offer, creates a mediasoup recv transport, produces the audio/video
  tracks into the `global-obs` channel, and returns an SDP answer. OBS
  `DELETE`s the returned resource URL when it stops.
- **Fan-out / viewers:** identical to screen share. Browsers join the
  `global-obs` channel over socket.io and consume via mediasoup-client
  (`useStreamingChannel`). The `ScreenObsStream` page renders the shared
  `RemoteVideo` player and `StreamDiagnostics` panel.
- **Single streamer:** the channel allows one WHIP publisher at a time; a
  second ingest attempt gets `409 already streaming`.

## Required setup on the host

WHIP needs the same mediasoup RTC ports / `MEDIASOUP_ANNOUNCED_IP` /
optional TURN as the screen-share channel (see
`docs/streaming-channel.md`). In addition:

### 1. Set a stream key

OBS authenticates with a shared bearer token. Set it in the app's
environment:

```
OBS_STREAM_KEY=<a-long-random-secret>
```

If it is unset, ingest is disabled and the `/obs` page says so. Any
logged-in user can read the key from the page (it is shown so they can
configure OBS), so treat it as a shared secret among trusted users —
rotate it by changing the env var and restarting.

### 2. Proxy the WHIP endpoint through nginx

OBS connects to the public HTTPS host, so nginx must forward the WHIP
path to the Node app (the same upstream that already serves the app).
WHIP bodies are SDP and can be a couple of KB — make sure the body size
limit is generous:

```nginx
location /api/whip {
    proxy_pass http://127.0.0.1:3000;   # the sync-party app upstream
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Authorization $http_authorization;  # keep the bearer token
    proxy_request_buffering off;
    client_max_body_size 2m;
}
```

(The app already lives behind nginx; this just makes the WHIP path and
the `Authorization` header pass through cleanly. The rest of `/api/` is
proxied as before.)

> Note: the actual media does **not** go through nginx — it flows over
> the mediasoup RTC UDP/TCP port range directly, encrypted with
> DTLS-SRTP. nginx only carries the WHIP signaling (the SDP offer/answer).

## Configure OBS

1. **Settings → Stream**
2. **Service:** `WHIP`
3. **Server:** `https://<your.domain>/api/whip`
4. **Bearer Token:** the `OBS_STREAM_KEY` value (shown on the `/obs` page)
5. **Output → Encoder:** H264 (`x264` or hardware). For low latency set
   **Keyframe Interval** to `1` or `2` seconds.
6. Click **Start Streaming**.

The `/obs` page goes live within a second or two; the diagnostics panel
shows `recv: connected` and `audio: track present` for viewers.

## Codecs

The router negotiates **H264** (preferred), **VP8**, and **Opus** — OBS's
WHIP output defaults to H264 + Opus, which matches. If you force a codec
OBS offers that the router doesn't (e.g. AV1), that track is dropped; keep
OBS on H264.

## Env vars (in addition to the screen-share table)

| Var | Default | Purpose |
|-----|---------|---------|
| `OBS_STREAM_KEY` | _(unset)_ | Bearer token for WHIP ingest; ingest is disabled until set |
