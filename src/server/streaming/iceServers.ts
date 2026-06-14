import { createHmac } from 'crypto';

export type IceServer = {
    urls: string | string[];
    username?: string;
    credential?: string;
};

/**
 * Build the WebRTC ICE-server list for a freshly-connecting peer.
 *
 * Configuration via env vars:
 *   STUN_URLS          — comma-separated list of stun: URLs
 *                        (default: stun:stun.l.google.com:19302)
 *   TURN_URLS          — comma-separated list of turn:/turns: URLs
 *                        (e.g. turn:turn.example.com:3478)
 *   TURN_AUTH_SECRET   — shared secret matching coturn's
 *                        `static-auth-secret` (use-auth-secret mode)
 *   TURN_CRED_TTL      — credential lifetime in seconds (default 3600)
 *
 * If TURN_URLS is set but TURN_AUTH_SECRET is not, the URLs are returned
 * with no credentials (works only against open relays, not real coturn).
 */
export const buildIceServers = (userId: string): IceServer[] => {
    const stunRaw = process.env.STUN_URLS || 'stun:stun.l.google.com:19302';
    const stunUrls = stunRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

    const servers: IceServer[] = stunUrls.length ? [{ urls: stunUrls }] : [];

    const turnRaw = process.env.TURN_URLS;
    if (!turnRaw) return servers;
    const turnUrls = turnRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    if (turnUrls.length === 0) return servers;

    const secret = process.env.TURN_AUTH_SECRET;
    if (!secret) {
        servers.push({ urls: turnUrls });
        return servers;
    }

    const ttl = Number(process.env.TURN_CRED_TTL) || 3600;
    // coturn `use-auth-secret`: username = "<unix-timestamp>:<id>",
    //                          credential = base64(HMAC-SHA1(username, secret))
    const expiry = Math.floor(Date.now() / 1000) + ttl;
    const username = `${expiry}:${userId}`;
    const credential = createHmac('sha1', secret)
        .update(username)
        .digest('base64');

    servers.push({ urls: turnUrls, username, credential });
    return servers;
};
