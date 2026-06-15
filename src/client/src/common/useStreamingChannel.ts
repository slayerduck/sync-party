import { useCallback, useEffect, useRef, useState } from 'react';
import Axios from 'axios';
import { Device } from 'mediasoup-client';

import { axiosConfig } from './helpers';

import type { types as msTypes } from 'mediasoup-client';
import type { Socket } from 'socket.io-client';
import type {
    StreamingNewProducerMessage,
    StreamingProducerClosedMessage,
    StreamingProducerInfo,
    StreamingStreamerChangedMessage
} from '../../../shared/types';

type Transport = msTypes.Transport;
type Producer = msTypes.Producer;
type Consumer = msTypes.Consumer;
type RtpCapabilities = msTypes.RtpCapabilities;
type DtlsParameters = msTypes.DtlsParameters;
type RtpParameters = msTypes.RtpParameters;
type MediaKind = msTypes.MediaKind;

// Shape of the transport parameters the server returns (mediasoup
// WebRtcTransport getters), used to build the client-side transport.
type ServerTransportInfo = {
    id: string;
    iceParameters: msTypes.IceParameters;
    iceCandidates: msTypes.IceCandidate[];
    dtlsParameters: DtlsParameters;
};

type IceServer = {
    urls: string | string[];
    username?: string;
    credential?: string;
};

type Ack<T> = (payload: T) => void;
type AckFail = { ok: false; error?: string };
type AckOk<T> = { ok: true } & T;
type AckRes<T = Record<string, never>> = AckOk<T> | AckFail;

const emitAck = <Result>(
    socket: Socket,
    event: string,
    data: unknown
): Promise<Result> =>
    new Promise((resolve) => {
        const fn: Ack<Result> = (res) => resolve(res);
        socket.emit(event, data, fn);
    });

export type ViewerStream = {
    userId: string;
    stream: MediaStream;
};

export type StreamingState = {
    /** Are we currently the active streamer? */
    isStreamer: boolean;
    /** UserId of the active streamer in this party, if any. */
    streamerUserId: string | null;
    /** The MediaStream we're previewing locally while streaming. */
    localStream: MediaStream | null;
    /** Incoming stream from the streamer, if anyone is streaming. */
    remoteStream: ViewerStream | null;
    error: string | null;
    // ---- Diagnostics ----
    /** Is the signaling socket currently connected? */
    socketConnected: boolean;
    /** Did /api/iceServers return a TURN entry (vs STUN-only)? */
    turnConfigured: boolean;
    /** ICE/DTLS connection state of our send transport (when streaming). */
    sendState: string;
    /** ICE/DTLS connection state of our recv transport (when viewing). */
    recvState: string;
    /** When streaming: did the screen capture include an audio track? */
    audioCaptured: boolean;
    /** When viewing: does the incoming stream carry an audio track? */
    remoteHasAudio: boolean;
    /** Last error while publishing a track (streamer), per kind. */
    produceError: string | null;
    /** Last error while subscribing to a track (viewer), per kind. */
    consumeError: string | null;
};

export type StartSharingOptions = {
    /** Also capture and broadcast the streamer's microphone. */
    includeMic?: boolean;
};

export type StreamingControls = {
    state: StreamingState;
    /** Start screen-sharing. Resolves once production has begun. */
    startSharing: (opts?: StartSharingOptions) => Promise<void>;
    /** Stop screen-sharing and release the streamer slot. */
    stopSharing: () => Promise<void>;
};

const noControls: StreamingControls = {
    state: {
        isStreamer: false,
        streamerUserId: null,
        localStream: null,
        remoteStream: null,
        error: null,
        socketConnected: false,
        turnConfigured: false,
        sendState: 'new',
        recvState: 'new',
        audioCaptured: true,
        remoteHasAudio: false,
        produceError: null,
        consumeError: null
    },
    startSharing: () => Promise.resolve(),
    stopSharing: () => Promise.resolve()
};

// Chrome-only DisplayMediaStreamOptions hints (not in the standard lib types)
// that make a screen/tab share include system/tab audio by default.
type ChromeDisplayMediaOptions = DisplayMediaStreamOptions & {
    systemAudio?: 'include' | 'exclude';
    surfaceSwitching?: 'include' | 'exclude';
};

/**
 * Hook that owns one mediasoup-client Device + the recv/send transports
 * for a single party. Mounting joins the streaming room; unmounting
 * tears everything down. Caller passes the live socket and the party id.
 */
export const useStreamingChannel = (
    socket: Socket | null,
    partyId: string | null,
    ourUserId: string | null
): StreamingControls => {
    const [state, setState] = useState<StreamingState>(noControls.state);

    const deviceRef = useRef<Device | null>(null);
    const sendTransportRef = useRef<Transport | null>(null);
    const recvTransportRef = useRef<Transport | null>(null);
    // In-flight recv-transport creation, shared by concurrent consumers so we
    // only ever create ONE recv transport (see ensureRecvTransport).
    const recvTransportPromiseRef = useRef<Promise<Transport> | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);
    const micStreamRef = useRef<MediaStream | null>(null);
    const remoteStreamRef = useRef<MediaStream | null>(null);
    const producersRef = useRef<Producer[]>([]);
    const consumersRef = useRef<Consumer[]>([]);
    const iceServersRef = useRef<IceServer[]>([]);
    // True once the initial join completed, so a later socket 'connect' is
    // recognised as a RECONNECT and triggers a re-join + resync.
    const joinedOnceRef = useRef(false);

    // Track whether this hook instance is still active so we can ignore
    // late async resolutions after teardown.
    const aliveRef = useRef(true);

    // Mirror of state.isStreamer for use inside socket-event closures that
    // are registered once and would otherwise capture a stale value.
    const isStreamerRef = useRef(false);
    useEffect(() => {
        isStreamerRef.current = state.isStreamer;
    }, [state.isStreamer]);

    const setStateSafe = useCallback((patch: Partial<StreamingState>): void => {
        if (!aliveRef.current) return;
        setState((cur) => ({ ...cur, ...patch }));
    }, []);

    const closeLocal = useCallback((): void => {
        for (const p of producersRef.current) {
            try {
                p.close();
            } catch {
                // best effort
            }
        }
        producersRef.current = [];

        if (localStreamRef.current) {
            for (const t of localStreamRef.current.getTracks()) t.stop();
            localStreamRef.current = null;
        }
        if (micStreamRef.current) {
            for (const t of micStreamRef.current.getTracks()) t.stop();
            micStreamRef.current = null;
        }
        if (sendTransportRef.current) {
            try {
                sendTransportRef.current.close();
            } catch {
                // best effort
            }
            sendTransportRef.current = null;
        }
        setStateSafe({
            isStreamer: false,
            localStream: null,
            produceError: null
        });
    }, [setStateSafe]);

    const closeRemote = useCallback((): void => {
        for (const c of consumersRef.current) {
            try {
                c.close();
            } catch {
                // best effort
            }
        }
        consumersRef.current = [];
        remoteStreamRef.current = null;
        setStateSafe({
            remoteStream: null,
            remoteHasAudio: false,
            consumeError: null
        });
    }, [setStateSafe]);

    const ensureRecvTransport = useCallback((): Promise<Transport> => {
        if (recvTransportRef.current) {
            return Promise.resolve(recvTransportRef.current);
        }
        // Dedupe: producers (video + audio) are consumed concurrently, so
        // without this several callers would each create their own recv
        // transport. The server closes the previous recv transport whenever a
        // new one is created, orphaning the earlier consumers (their media
        // never flows). Cache the in-flight creation so everyone shares one.
        if (recvTransportPromiseRef.current) {
            return recvTransportPromiseRef.current;
        }
        const creation = (async (): Promise<Transport> => {
            if (!socket || !partyId || !deviceRef.current) {
                throw new Error('not ready');
            }
            const res = await emitAck<
                AckRes<{ transport: ServerTransportInfo }>
            >(socket, 'streaming:createTransport', {
                partyId,
                direction: 'recv'
            });
            if (!res.ok) throw new Error(res.error || 'createTransport failed');
            const transport = deviceRef.current.createRecvTransport({
                ...res.transport,
                iceServers: iceServersRef.current
            });
            transport.on('connect', ({ dtlsParameters }, callback, errback) => {
                emitAck<AckRes>(socket, 'streaming:connectTransport', {
                    partyId,
                    transportId: transport.id,
                    dtlsParameters
                }).then((r) => {
                    if (r.ok) callback();
                    else errback(new Error(r.error || 'connect failed'));
                });
            });
            transport.on('connectionstatechange', (s) => {
                setStateSafe({ recvState: s });
            });
            recvTransportRef.current = transport;
            return transport;
        })();
        recvTransportPromiseRef.current = creation;
        // If creation fails, clear the cache so a later consume can retry.
        creation.catch(() => {
            recvTransportPromiseRef.current = null;
        });
        return creation;
    }, [socket, partyId, setStateSafe]);

    const consumeProducer = useCallback(
        async (producer: StreamingProducerInfo): Promise<void> => {
            if (!socket || !partyId || !deviceRef.current) return;
            try {
                const transport = await ensureRecvTransport();
                const res = await emitAck<
                    AckRes<{
                        consumer: {
                            id: string;
                            producerId: string;
                            kind: MediaKind;
                            rtpParameters: RtpParameters;
                        };
                    }>
                >(socket, 'streaming:consume', {
                    partyId,
                    producerId: producer.producerId,
                    rtpCapabilities: deviceRef.current.rtpCapabilities
                });
                if (!res.ok) {
                    setStateSafe({
                        consumeError: `${producer.kind}: ${
                            res.error || 'consume rejected'
                        }`
                    });
                    return;
                }
                const consumer = await transport.consume({
                    id: res.consumer.id,
                    producerId: res.consumer.producerId,
                    kind: res.consumer.kind,
                    rtpParameters: res.consumer.rtpParameters
                });
                consumersRef.current.push(consumer);
                // Rebuild the remote stream from ALL current consumer tracks
                // as a fresh MediaStream object. Producers arrive as separate
                // events (video, then audio), so a same-reference stream that
                // we only addTrack() to often won't get its newly-added audio
                // track played by a <video> element that already started.
                // A new object reference also forces the element to re-attach.
                remoteStreamRef.current = new MediaStream(
                    consumersRef.current.map((c) => c.track)
                );
                const remoteHasAudio = consumersRef.current.some(
                    (c) => c.track.kind === 'audio'
                );
                setStateSafe({
                    remoteStream: {
                        userId: producer.userId,
                        stream: remoteStreamRef.current
                    },
                    remoteHasAudio,
                    // A track came through; clear any earlier consume error.
                    consumeError: null
                });
                await emitAck<AckRes>(socket, 'streaming:resumeConsumer', {
                    partyId,
                    consumerId: consumer.id
                });
            } catch (err) {
                setStateSafe({
                    consumeError: `${producer.kind}: ${
                        err instanceof Error ? err.message : String(err)
                    }`
                });
            }
        },
        [socket, partyId, ensureRecvTransport, setStateSafe]
    );

    // --- Lifecycle ---

    useEffect(() => {
        aliveRef.current = true;
        if (!socket || !partyId || !ourUserId) {
            return (): void => {
                aliveRef.current = false;
            };
        }

        let cancelled = false;

        const onStreamerChanged = (
            msg: StreamingStreamerChangedMessage
        ): void => {
            if (msg.partyId !== partyId) return;
            setStateSafe({ streamerUserId: msg.streamerUserId });
            if (msg.streamerUserId === null) {
                closeRemote();
                // isStreamerRef (not the captured `state`) so this reflects
                // the live value rather than the value at effect-setup time.
                if (isStreamerRef.current) closeLocal();
            }
        };

        const onNewProducer = (msg: StreamingNewProducerMessage): void => {
            if (msg.partyId !== partyId) return;
            // If THIS connection is the streamer, the producer is our own —
            // don't consume it. (Keyed on our role, not userId, so a second
            // device of the same user still consumes the stream.)
            if (isStreamerRef.current) return;
            consumeProducer(msg.producer);
        };

        const onProducerClosed = (
            msg: StreamingProducerClosedMessage
        ): void => {
            if (msg.partyId !== partyId) return;
            const idx = consumersRef.current.findIndex(
                (c) => c.producerId === msg.producerId
            );
            if (idx === -1) return;
            const consumer = consumersRef.current[idx];
            try {
                consumer.close();
            } catch {
                // best effort
            }
            consumersRef.current.splice(idx, 1);
            if (remoteStreamRef.current) {
                try {
                    remoteStreamRef.current.removeTrack(consumer.track);
                } catch {
                    // best effort
                }
                if (remoteStreamRef.current.getTracks().length === 0) {
                    remoteStreamRef.current = null;
                    setStateSafe({ remoteStream: null });
                }
            }
        };

        // After a reconnect the socket has a NEW id, so the server's room
        // membership, our peer, transports and any streamer slot we held are
        // all gone. Re-enter the channel from scratch: drop a dead streamer
        // role, tear down the dead recv transport, rejoin to resync the
        // current streamer, and re-consume whatever is live now.
        const rejoinAfterReconnect = async (): Promise<void> => {
            try {
                if (isStreamerRef.current) closeLocal();
                closeRemote();
                if (recvTransportRef.current) {
                    try {
                        recvTransportRef.current.close();
                    } catch {
                        // best effort
                    }
                    recvTransportRef.current = null;
                }
                recvTransportPromiseRef.current = null;

                const joinRes = await emitAck<
                    AckRes<{
                        streamerUserId: string | null;
                        producers: StreamingProducerInfo[];
                    }>
                >(socket, 'streaming:join', { partyId });
                if (cancelled || !joinRes.ok) return;
                setStateSafe({
                    streamerUserId: joinRes.streamerUserId,
                    error: null
                });
                if (!isStreamerRef.current) {
                    for (const p of joinRes.producers) consumeProducer(p);
                }
            } catch (err) {
                setStateSafe({ error: String(err) });
            }
        };

        const onConnect = (): void => {
            setStateSafe({ socketConnected: true });
            if (joinedOnceRef.current) rejoinAfterReconnect();
        };
        const onDisconnect = (): void =>
            setStateSafe({ socketConnected: false });

        socket.on('streaming:streamerChanged', onStreamerChanged);
        socket.on('streaming:newProducer', onNewProducer);
        socket.on('streaming:producerClosed', onProducerClosed);
        socket.on('connect', onConnect);
        socket.on('disconnect', onDisconnect);
        setStateSafe({ socketConnected: socket.connected });

        (async (): Promise<void> => {
            try {
                const iceRes = await Axios.get<{ iceServers: IceServer[] }>(
                    '/api/iceServers',
                    axiosConfig()
                );
                iceServersRef.current = iceRes.data.iceServers || [];
                const turnConfigured = iceServersRef.current.some((s) => {
                    const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
                    return urls.some((u) => u.startsWith('turn:'));
                });
                setStateSafe({ turnConfigured });

                const joinRes = await emitAck<
                    AckRes<{
                        rtpCapabilities: RtpCapabilities;
                        streamerUserId: string | null;
                        producers: StreamingProducerInfo[];
                    }>
                >(socket, 'streaming:join', { partyId });
                if (cancelled || !joinRes.ok) return;

                const device = new Device();
                await device.load({
                    routerRtpCapabilities: joinRes.rtpCapabilities
                });
                deviceRef.current = device;
                joinedOnceRef.current = true;
                setStateSafe({
                    streamerUserId: joinRes.streamerUserId,
                    error: null
                });

                // We just joined, so we're a viewer — the server already
                // excluded our own producers. Consume everything present.
                for (const p of joinRes.producers) {
                    consumeProducer(p);
                }
            } catch (err) {
                setStateSafe({ error: String(err) });
            }
        })();

        return (): void => {
            aliveRef.current = false;
            cancelled = true;
            socket.off('streaming:streamerChanged', onStreamerChanged);
            socket.off('streaming:newProducer', onNewProducer);
            socket.off('streaming:producerClosed', onProducerClosed);
            socket.off('connect', onConnect);
            socket.off('disconnect', onDisconnect);
            closeLocal();
            closeRemote();
            if (recvTransportRef.current) {
                try {
                    recvTransportRef.current.close();
                } catch {
                    // best effort
                }
                recvTransportRef.current = null;
            }
            recvTransportPromiseRef.current = null;
            joinedOnceRef.current = false;
            try {
                socket.emit('streaming:leave', { partyId });
            } catch {
                // best effort
            }
            deviceRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [socket, partyId, ourUserId]);

    const startSharing = useCallback(
        async (opts?: StartSharingOptions): Promise<void> => {
            if (!socket || !partyId || !deviceRef.current) {
                throw new Error('not ready');
            }
            // Let the server be the sole authority on the slot — don't bail
            // on our possibly-stale local view, so a missed streamerChanged
            // can't permanently block taking over an idle channel.
            const claim = await emitAck<{
                ok: boolean;
                streamerUserId?: string | null;
                error?: string;
            }>(socket, 'streaming:claimStreamer', { partyId });
            if (!claim.ok) {
                // Sync to the server's truth so the UI reflects who really has
                // the slot (and re-enables once they stop).
                setStateSafe({ streamerUserId: claim.streamerUserId ?? null });
                throw new Error('another user is already streaming');
            }
            // Fresh attempt: drop any stale publish error from a prior share.
            setStateSafe({ produceError: null });

            // Get the screen capture. Cap framerate/resolution to keep the
            // streamer's encoder load (and thus lag) down; ask for audio with
            // processing off so system/tab audio isn't mangled. NB: browsers only
            // capture audio for a TAB or the ENTIRE SCREEN — a single-window share
            // is always video-only (and Firefox can't capture display audio at
            // all). systemAudio:'include' makes Chrome default to including it.
            let stream: MediaStream;
            try {
                const displayOptions: ChromeDisplayMediaOptions = {
                    video: {
                        frameRate: { ideal: 30, max: 30 },
                        width: { max: 1920 },
                        height: { max: 1080 }
                    },
                    audio: {
                        echoCancellation: false,
                        noiseSuppression: false,
                        autoGainControl: false
                    },
                    systemAudio: 'include',
                    surfaceSwitching: 'include'
                };
                stream = await navigator.mediaDevices.getDisplayMedia(
                    displayOptions
                );
            } catch (err) {
                await emitAck<AckRes>(socket, 'streaming:releaseStreamer', {
                    partyId
                });
                throw err;
            }
            localStreamRef.current = stream;

            // Optional microphone: a guaranteed audio path that works even for a
            // window share (which carries no display audio) and on Firefox. This
            // broadcasts the streamer's mic, not the shared app's own sound.
            if (opts?.includeMic) {
                try {
                    const micStream = await navigator.mediaDevices.getUserMedia(
                        {
                            audio: {
                                echoCancellation: true,
                                noiseSuppression: true,
                                autoGainControl: true
                            }
                        }
                    );
                    micStreamRef.current = micStream;
                    for (const t of micStream.getAudioTracks()) {
                        stream.addTrack(t);
                    }
                } catch {
                    // mic denied/unavailable — carry on with whatever we have
                }
            }

            // Create the send transport server-side and wrap it client-side.
            const res = await emitAck<
                AckRes<{ transport: ServerTransportInfo }>
            >(socket, 'streaming:createTransport', {
                partyId,
                direction: 'send'
            });
            if (!res.ok) throw new Error(res.error || 'createTransport failed');

            const transport = deviceRef.current.createSendTransport({
                ...res.transport,
                iceServers: iceServersRef.current
            });
            sendTransportRef.current = transport;

            transport.on('connect', ({ dtlsParameters }, callback, errback) => {
                emitAck<AckRes>(socket, 'streaming:connectTransport', {
                    partyId,
                    transportId: transport.id,
                    dtlsParameters
                }).then((r) => {
                    if (r.ok) callback();
                    else errback(new Error(r.error || 'connect failed'));
                });
            });

            transport.on('connectionstatechange', (s) => {
                setStateSafe({ sendState: s });
            });

            transport.on(
                'produce',
                ({ kind, rtpParameters }, callback, errback) => {
                    emitAck<AckRes<{ producerId: string }>>(
                        socket,
                        'streaming:produce',
                        {
                            partyId,
                            transportId: transport.id,
                            kind,
                            rtpParameters
                        }
                    ).then((r) => {
                        if (r.ok) callback({ id: r.producerId });
                        else errback(new Error(r.error || 'produce failed'));
                    });
                }
            );

            // Prefer H264 for the video producer when the browser advertises it
            // (hardware encode); otherwise mediasoup falls back to VP8.
            const h264Codec = deviceRef.current.rtpCapabilities.codecs?.find(
                (c) => c.mimeType.toLowerCase() === 'video/h264'
            );

            for (const track of stream.getTracks()) {
                try {
                    if (track.kind === 'video') {
                        // Hint that this is detailed/static screen content so the
                        // encoder favours sharpness over framerate.
                        try {
                            track.contentHint = 'detail';
                        } catch {
                            // contentHint may be read-only in some browsers
                        }
                        const producer = await transport.produce({
                            track,
                            encodings: [{ maxBitrate: 3_000_000 }],
                            codecOptions: { videoGoogleStartBitrate: 1000 },
                            ...(h264Codec ? { codec: h264Codec } : {})
                        });
                        producersRef.current.push(producer);
                    } else {
                        const producer = await transport.produce({ track });
                        producersRef.current.push(producer);
                    }
                } catch (err) {
                    // Keep publishing the other tracks, but surface which kind
                    // failed so a missing-audio/video producer is diagnosable.
                    setStateSafe({
                        produceError: `${track.kind}: ${
                            err instanceof Error ? err.message : String(err)
                        }`
                    });
                }
            }

            // If the user stops sharing via the browser's "Stop sharing" UI,
            // release the streamer slot.
            const videoTrack = stream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.addEventListener('ended', () => {
                    // eslint-disable-next-line @typescript-eslint/no-use-before-define
                    stopSharingRef.current?.();
                });
            }

            setStateSafe({
                isStreamer: true,
                localStream: stream,
                audioCaptured: stream.getAudioTracks().length > 0
            });
        },
        [socket, partyId, setStateSafe]
    );

    const stopSharing = useCallback(async (): Promise<void> => {
        if (!socket || !partyId) return;
        closeLocal();
        await emitAck<AckRes>(socket, 'streaming:releaseStreamer', {
            partyId
        });
    }, [socket, partyId, closeLocal]);

    // Forward ref for the track.ended handler closure above.
    const stopSharingRef = useRef(stopSharing);
    useEffect(() => {
        stopSharingRef.current = stopSharing;
    }, [stopSharing]);

    return { state, startSharing, stopSharing };
};
