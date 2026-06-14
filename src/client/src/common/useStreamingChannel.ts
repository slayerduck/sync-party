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
};

export type StreamingControls = {
    state: StreamingState;
    /** Start screen-sharing. Resolves once production has begun. */
    startSharing: () => Promise<void>;
    /** Stop screen-sharing and release the streamer slot. */
    stopSharing: () => Promise<void>;
};

const noControls: StreamingControls = {
    state: {
        isStreamer: false,
        streamerUserId: null,
        localStream: null,
        remoteStream: null,
        error: null
    },
    startSharing: () => Promise.resolve(),
    stopSharing: () => Promise.resolve()
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
    const localStreamRef = useRef<MediaStream | null>(null);
    const remoteStreamRef = useRef<MediaStream | null>(null);
    const producersRef = useRef<Producer[]>([]);
    const consumersRef = useRef<Consumer[]>([]);
    const iceServersRef = useRef<IceServer[]>([]);

    // Track whether this hook instance is still active so we can ignore
    // late async resolutions after teardown.
    const aliveRef = useRef(true);

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
        if (sendTransportRef.current) {
            try {
                sendTransportRef.current.close();
            } catch {
                // best effort
            }
            sendTransportRef.current = null;
        }
        setStateSafe({ isStreamer: false, localStream: null });
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
        setStateSafe({ remoteStream: null });
    }, [setStateSafe]);

    const ensureRecvTransport = useCallback(async (): Promise<Transport> => {
        if (recvTransportRef.current) return recvTransportRef.current;
        if (!socket || !partyId || !deviceRef.current) {
            throw new Error('not ready');
        }
        const res = await emitAck<AckRes<{ transport: ServerTransportInfo }>>(
            socket,
            'streaming:createTransport',
            {
                partyId,
                direction: 'recv'
            }
        );
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
        recvTransportRef.current = transport;
        return transport;
    }, [socket, partyId]);

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
                if (!res.ok) return;
                const consumer = await transport.consume({
                    id: res.consumer.id,
                    producerId: res.consumer.producerId,
                    kind: res.consumer.kind,
                    rtpParameters: res.consumer.rtpParameters
                });
                consumersRef.current.push(consumer);
                if (!remoteStreamRef.current) {
                    remoteStreamRef.current = new MediaStream();
                }
                remoteStreamRef.current.addTrack(consumer.track);
                setStateSafe({
                    remoteStream: {
                        userId: producer.userId,
                        stream: remoteStreamRef.current
                    }
                });
                await emitAck<AckRes>(socket, 'streaming:resumeConsumer', {
                    partyId,
                    consumerId: consumer.id
                });
            } catch {
                // ignore individual consume failures
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
                if (state.isStreamer) closeLocal();
            }
        };

        const onNewProducer = (msg: StreamingNewProducerMessage): void => {
            if (msg.partyId !== partyId) return;
            if (msg.producer.userId === ourUserId) return;
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

        socket.on('streaming:streamerChanged', onStreamerChanged);
        socket.on('streaming:newProducer', onNewProducer);
        socket.on('streaming:producerClosed', onProducerClosed);

        (async (): Promise<void> => {
            try {
                const iceRes = await Axios.get<{ iceServers: IceServer[] }>(
                    '/api/iceServers',
                    axiosConfig()
                );
                iceServersRef.current = iceRes.data.iceServers || [];

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
                setStateSafe({
                    streamerUserId: joinRes.streamerUserId,
                    error: null
                });

                for (const p of joinRes.producers) {
                    if (p.userId !== ourUserId) consumeProducer(p);
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
            try {
                socket.emit('streaming:leave', { partyId });
            } catch {
                // best effort
            }
            deviceRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [socket, partyId, ourUserId]);

    const startSharing = useCallback(async (): Promise<void> => {
        if (!socket || !partyId || !deviceRef.current) {
            throw new Error('not ready');
        }
        if (state.streamerUserId && state.streamerUserId !== ourUserId) {
            throw new Error('another user is already streaming');
        }

        const claim = await emitAck<AckRes>(socket, 'streaming:claimStreamer', {
            partyId
        });
        if (!claim.ok) {
            throw new Error('streamer slot taken');
        }

        // Get the screen capture.
        let stream: MediaStream;
        try {
            stream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: true
            });
        } catch (err) {
            await emitAck<AckRes>(socket, 'streaming:releaseStreamer', {
                partyId
            });
            throw err;
        }
        localStreamRef.current = stream;

        // Create the send transport server-side and wrap it client-side.
        const res = await emitAck<AckRes<{ transport: ServerTransportInfo }>>(
            socket,
            'streaming:createTransport',
            {
                partyId,
                direction: 'send'
            }
        );
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

        for (const track of stream.getTracks()) {
            try {
                const producer = await transport.produce({ track });
                producersRef.current.push(producer);
            } catch {
                // ignore individual track failure; we still publish the others
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

        setStateSafe({ isStreamer: true, localStream: stream });
    }, [socket, partyId, ourUserId, state.streamerUserId, setStateSafe]);

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
