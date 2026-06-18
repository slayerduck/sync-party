// WHIP (WebRTC-HTTP Ingestion Protocol) glue for OBS -> mediasoup.
//
// OBS posts an SDP offer; we turn each media section into a mediasoup
// Producer on a recv transport and hand back an SDP answer. mediasoup does
// not speak SDP, so this module bridges the two using sdp-transform.
import * as sdpTransform from 'sdp-transform';

import type { types as msTypes } from 'mediasoup';

type Router = msTypes.Router;
type WebRtcTransport = msTypes.WebRtcTransport;
type RtpParameters = msTypes.RtpParameters;
type MediaKind = msTypes.MediaKind;
type DtlsFingerprint = msTypes.DtlsFingerprint;
type FingerprintAlgorithm = DtlsFingerprint['algorithm'];
type RtpCodecParameters = RtpParameters['codecs'][number];
type RtpEncodingParameters = NonNullable<RtpParameters['encodings']>[number];
type RtpHeaderExtensionParameters = NonNullable<
    RtpParameters['headerExtensions']
>[number];
type RtpHeaderExtensionUri = RtpHeaderExtensionParameters['uri'];

type ParsedMedia = sdpTransform.MediaDescription;

const parseFmtpConfig = (config: string): Record<string, number | string> => {
    const out: Record<string, number | string> = {};
    for (const part of config.split(';')) {
        const [k, v] = part.trim().split('=');
        if (!k) continue;
        out[k] = v !== undefined && /^\d+$/.test(v) ? Number(v) : v ?? '';
    }
    return out;
};

const stringifyFmtp = (params: Record<string, number | string>): string =>
    Object.entries(params)
        .map(([k, v]) => `${k}=${v}`)
        .join(';');

/** Pull the DTLS fingerprint from the offer (media- or session-level). */
export const extractDtlsFingerprints = (
    offer: sdpTransform.SessionDescription
): DtlsFingerprint[] => {
    const fps: DtlsFingerprint[] = [];
    const add = (fp?: { type: string; hash: string }): void => {
        if (fp) {
            fps.push({
                algorithm: fp.type as FingerprintAlgorithm,
                value: fp.hash
            });
        }
    };
    add(offer.fingerprint);
    for (const m of offer.media) add(m.fingerprint);
    return fps;
};

type BuiltProduce = {
    kind: MediaKind;
    rtpParameters: RtpParameters;
    // Answer scaffolding for this section.
    answer: {
        primaryPayload: number;
        codecName: string;
        clockRate: number;
        channels?: number;
        rtxPayload?: number;
        fmtpParams: Record<string, number | string>;
        rtcpFb: { type: string; subtype?: string }[];
        ext: { value: number; uri: string }[];
        mid: string;
    };
};

/**
 * Choose a codec the router supports for this offered media section and build
 * the mediasoup produce rtpParameters, or null if nothing matches.
 */
export const buildProduceParams = (
    router: Router,
    m: ParsedMedia
): BuiltProduce | null => {
    const kind = m.type as MediaKind;
    if (kind !== 'audio' && kind !== 'video') return null;

    const routerCodecs = router.rtpCapabilities.codecs ?? [];
    const offerRtp = m.rtp ?? [];

    // First offered payload whose codec the router also offers (skip rtx).
    let primary: sdpTransform.MediaDescription['rtp'][number] | undefined;
    let routerMime: string | undefined;
    for (const r of offerRtp) {
        if (r.codec.toLowerCase() === 'rtx') continue;
        const mime = `${kind}/${r.codec}`.toLowerCase();
        const match = routerCodecs.find(
            (c) => c.kind === kind && c.mimeType.toLowerCase() === mime
        );
        if (match) {
            primary = r;
            routerMime = match.mimeType;
            break;
        }
    }
    if (!primary || !routerMime) return null;
    const primaryPayload = primary.payload;

    const fmtp = (m.fmtp ?? []).find((f) => f.payload === primaryPayload);
    const fmtpParams = fmtp ? parseFmtpConfig(fmtp.config) : {};

    const rtcpFb = (m.rtcpFb ?? [])
        .filter((fb) => fb.payload === primaryPayload || fb.payload === '*')
        .map((fb) => ({ type: fb.type, subtype: fb.subtype }));

    const channels = kind === 'audio' ? primary.encoding || 2 : undefined;

    const codecs: RtpCodecParameters[] = [
        {
            mimeType: routerMime,
            payloadType: primary.payload,
            clockRate: primary.rate ?? (kind === 'audio' ? 48000 : 90000),
            ...(channels ? { channels } : {}),
            parameters: fmtpParams,
            rtcpFeedback: rtcpFb.map((fb) => ({
                type: fb.type,
                parameter: fb.subtype || ''
            }))
        }
    ];

    // RTX (retransmission) for video, matched via fmtp apt=<primary>.
    let rtxPayload: number | undefined;
    if (kind === 'video') {
        for (const r of offerRtp) {
            if (r.codec.toLowerCase() !== 'rtx') continue;
            const f = (m.fmtp ?? []).find((ff) => ff.payload === r.payload);
            const apt = f ? parseFmtpConfig(f.config).apt : undefined;
            if (apt !== undefined && Number(apt) === primary.payload) {
                rtxPayload = r.payload;
                codecs.push({
                    mimeType: `${kind}/rtx`,
                    payloadType: r.payload,
                    clockRate: r.rate ?? 90000,
                    parameters: { apt: primary.payload },
                    rtcpFeedback: []
                });
                break;
            }
        }
    }

    // Header extensions limited to what the router supports for this kind.
    const supportedUris = new Set<string>(
        (router.rtpCapabilities.headerExtensions ?? [])
            .filter((e) => e.kind === kind)
            .map((e) => e.uri)
    );
    const ext = (m.ext ?? [])
        .filter((e) => !e['encrypt-uri'] && supportedUris.has(e.uri))
        .map((e) => ({ value: e.value, uri: e.uri }));
    const headerExtensions: RtpHeaderExtensionParameters[] = ext.map((e) => ({
        uri: e.uri as RtpHeaderExtensionUri,
        id: e.value
    }));

    // Encodings from the offered SSRCs (+ rtx ssrc from the FID group).
    const ssrcGroup = (m.ssrcGroups ?? []).find((g) => g.semantics === 'FID');
    let ssrc: number | undefined;
    let rtxSsrc: number | undefined;
    if (ssrcGroup) {
        const ids = String(ssrcGroup.ssrcs).split(/\s+/).map(Number);
        ssrc = ids[0];
        rtxSsrc = ids[1];
    } else if (m.ssrcs && m.ssrcs.length) {
        ssrc = Number(m.ssrcs[0].id);
    }
    const encodings: RtpEncodingParameters[] = [];
    if (ssrc !== undefined) {
        encodings.push(
            rtxSsrc !== undefined ? { ssrc, rtx: { ssrc: rtxSsrc } } : { ssrc }
        );
    }

    const cnameSsrc = (m.ssrcs ?? []).find((s) => s.attribute === 'cname');
    const rtpParameters: RtpParameters = {
        mid: m.mid !== undefined ? String(m.mid) : undefined,
        codecs,
        headerExtensions,
        encodings,
        rtcp: {
            cname: cnameSsrc ? String(cnameSsrc.value) : 'whip',
            reducedSize: true
        }
    };

    return {
        kind,
        rtpParameters,
        answer: {
            primaryPayload: primary.payload,
            codecName: routerMime.split('/')[1],
            clockRate: codecs[0].clockRate,
            channels,
            rtxPayload,
            fmtpParams,
            rtcpFb,
            ext,
            mid: m.mid !== undefined ? String(m.mid) : '0'
        }
    };
};

/** Build the SDP answer for the produced media. */
export const buildAnswerSdp = (
    transport: WebRtcTransport,
    built: BuiltProduce[]
): string => {
    const ice = transport.iceParameters;
    const fp =
        transport.dtlsParameters.fingerprints.find(
            (f) => f.algorithm === 'sha-256'
        ) ?? transport.dtlsParameters.fingerprints[0];

    const candidates = transport.iceCandidates.map((c) => ({
        foundation: c.foundation,
        component: 1,
        transport: c.protocol,
        priority: c.priority,
        ip: c.ip,
        port: c.port,
        type: c.type,
        ...(c.tcpType ? { tcptype: c.tcpType } : {})
    }));

    const media = built.map((b) => {
        const a = b.answer;
        const rtp: sdpTransform.MediaDescription['rtp'] = [
            {
                payload: a.primaryPayload,
                codec: a.codecName,
                rate: a.clockRate,
                ...(a.channels ? { encoding: a.channels } : {})
            }
        ];
        const fmtp: sdpTransform.MediaDescription['fmtp'] = [];
        if (Object.keys(a.fmtpParams).length) {
            fmtp.push({
                payload: a.primaryPayload,
                config: stringifyFmtp(a.fmtpParams)
            });
        }
        if (a.rtxPayload !== undefined) {
            rtp.push({
                payload: a.rtxPayload,
                codec: 'rtx',
                rate: a.clockRate
            });
            fmtp.push({
                payload: a.rtxPayload,
                config: `apt=${a.primaryPayload}`
            });
        }
        return {
            type: b.kind,
            port: 7,
            protocol: 'UDP/TLS/RTP/SAVPF',
            payloads: [a.primaryPayload, a.rtxPayload]
                .filter((p) => p !== undefined)
                .join(' '),
            connection: { version: 4, ip: '127.0.0.1' },
            rtcp: { port: 9, netType: 'IN', ipVer: 4, address: '0.0.0.0' },
            iceUfrag: ice.usernameFragment,
            icePwd: ice.password,
            fingerprint: { type: fp.algorithm, hash: fp.value },
            setup: 'passive',
            mid: a.mid,
            direction: 'recvonly' as const,
            rtcpMux: 'rtcp-mux',
            rtcpRsize: 'rtcp-rsize',
            rtp,
            fmtp,
            rtcpFb: a.rtcpFb.map((fb) => ({
                payload: a.primaryPayload,
                type: fb.type,
                subtype: fb.subtype
            })),
            ext: a.ext,
            candidates,
            endOfCandidates: 'end-of-candidates'
        };
    });

    const answer: sdpTransform.SessionDescription = {
        version: 0,
        origin: {
            username: '-',
            sessionId: Date.now(),
            sessionVersion: 2,
            netType: 'IN',
            ipVer: 4,
            address: '127.0.0.1'
        },
        name: '-',
        timing: { start: 0, stop: 0 },
        icelite: 'ice-lite',
        groups: [
            { type: 'BUNDLE', mids: built.map((b) => b.answer.mid).join(' ') }
        ],
        msidSemantic: { semantic: 'WMS', token: '*' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        media: media as any
    };

    return sdpTransform.write(answer);
};
