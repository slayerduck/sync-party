# Sync Party fork — working context

## Project
Self-hosted **Sync Party** (watch-party app: synced video playback, chat, WebRTC cam/mic). Fork at `slayerduck/sync-party`. We've been adding upload/convert tooling and a screen-share channel.

## Repo / branches
- Working branch: `claude/increase-upload-limits-QcVbG`. Every change is also pushed to **`master`**.
- Production server: `homie.slayerduck.com` (AlmaLinux 9), deployed at `/home/homie/sync-party-fork`, behind nginx (basic-auth), run via **pm2 fork mode, single instance** (required — streaming state is in-process). Deploy with `git pull && npm run prod:deploy`. Node 22 required (mediasoup).
- Local dev: server on port 3000 (HTTPS, self-signed), websockets on 4000. `npm run prod:server:build` / `prod:client:build`, lint with `npm run lint` (keep 0 errors).

## What's been built (done + deployed)
1. **Upload limits** raised to 25GB.
2. **Zip upload** → auto-detects mkv/avi etc., extracts, **batch-converts** with one shared audio/subtitle track picker; max 4 concurrent ffmpeg via a pool.
3. **ffmpeg conversion** normalized for browser playback (H264 High@L4.1 yuv420p, AAC-LC, CRF 21, `nice` low-priority), live progress bars, failure logs under `data/uploads/_log/`, retry UI.
4. **Dashboard** redesign + decorative duck; **"Upload & convert"** page (multi-file, pick target room); **"Processing files"** page (resume pending/failed conversions).
5. **Screen-share channel** — single global channel via embedded **mediasoup SFU** + coturn TURN. Reached from dashboard "Screen share" → `/screenshare`. One streamer, rest viewers. Has a live **"Connection diagnostics"** panel. (See `docs/streaming-channel.md` for host setup: mediasoup RTC port range, `MEDIASOUP_ANNOUNCED_IP`, coturn `use-auth-secret`, env-var table.)

## Bugs fixed recently
- Screen-share "each device starts its own, neither sees the other" → was keyed by **userId**; now keyed by **socket id** (same account on 2 devices works).
- pm2 cluster / split-brain diagnostics added to server logs (`pid=`, `roomSockets=`).
- Pre-existing `PUT /api/party` crash on malformed body (guarded).

## Currently working on (screen-share polish)
- **Audio**: Firefox can't capture system audio at all → no sound. Fix = stream from **Chrome** + tick "Share tab/system audio". UI now warns when no audio track captured. **Open option:** could add a "share microphone" toggle (works on Firefox) if wanted.
- **Lag**: just shipped H264 (hardware encode) preference + VP8 fallback, capture capped to 30fps/1080p, 3 Mbps ceiling + "detail" content hint. **Needs real-world retest after deploy.** If still laggy, easy knobs: drop to 15fps / 720p / lower bitrate.
- **Proposed next:** add the negotiated codec (H264 vs VP8) to the diagnostics panel to confirm hardware encode engaged.

## Latest commit
`76b124f` — "Streaming: H264 + capture caps to cut lag; flag missing screen audio"
