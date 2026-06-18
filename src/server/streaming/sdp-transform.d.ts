// Minimal ambient types for sdp-transform (the package ships no .d.ts).
// Only the fields used by streaming/whip.ts are declared.
declare module 'sdp-transform' {
    export interface SsrcAttribute {
        id: string | number;
        attribute?: string;
        value?: string;
    }
    export interface SsrcGroup {
        semantics: string;
        ssrcs: string;
    }
    export interface RtpMap {
        payload: number;
        codec: string;
        rate?: number;
        encoding?: number;
    }
    export interface Fmtp {
        payload: number;
        config: string;
    }
    export interface RtcpFb {
        payload: number | string;
        type: string;
        subtype?: string;
    }
    export interface Ext {
        value: number;
        uri: string;
        'encrypt-uri'?: string;
        direction?: string;
    }
    export interface Candidate {
        foundation: string;
        component: number;
        transport: string;
        priority: number;
        ip: string;
        port: number;
        type: string;
        raddr?: string;
        rport?: number;
        tcptype?: string;
        generation?: number;
    }
    export interface Fingerprint {
        type: string;
        hash: string;
    }
    export interface MediaDescription {
        type: string;
        port: number;
        protocol: string;
        payloads?: string;
        rtp: RtpMap[];
        fmtp: Fmtp[];
        rtcpFb?: RtcpFb[];
        ext?: Ext[];
        ssrcs?: SsrcAttribute[];
        ssrcGroups?: SsrcGroup[];
        mid?: string | number;
        fingerprint?: Fingerprint;
        setup?: string;
        iceUfrag?: string;
        icePwd?: string;
        direction?: string;
        connection?: { version: number; ip: string };
        rtcp?: {
            port: number;
            netType?: string;
            ipVer?: number;
            address?: string;
        };
        rtcpMux?: string;
        rtcpRsize?: string;
        candidates?: Candidate[];
        endOfCandidates?: string;
        [key: string]: unknown;
    }
    export interface SessionDescription {
        version?: number;
        origin?: {
            username: string;
            sessionId: string | number;
            sessionVersion: number;
            netType: string;
            ipVer: number;
            address: string;
        };
        name?: string;
        timing?: { start: number; stop: number };
        fingerprint?: Fingerprint;
        icelite?: string;
        groups?: { type: string; mids: string }[];
        msidSemantic?: { semantic: string; token: string };
        media: MediaDescription[];
        [key: string]: unknown;
    }
    export function parse(sdp: string): SessionDescription;
    export function write(session: SessionDescription): string;
}
