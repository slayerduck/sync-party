import * as mediasoup from 'mediasoup';
type Worker = mediasoup.types.Worker;
type Router = mediasoup.types.Router;
type WebRtcTransport = mediasoup.types.WebRtcTransport;
type Producer = mediasoup.types.Producer;
type Consumer = mediasoup.types.Consumer;
type DtlsParameters = mediasoup.types.DtlsParameters;
type RtpCapabilities = mediasoup.types.RtpCapabilities;
type RtpParameters = mediasoup.types.RtpParameters;
type MediaKind = mediasoup.types.MediaKind;

const MEDIA_CODECS: mediasoup.types.RtpCodecCapability[] = [
    {
        kind: 'audio',
        preferredPayloadType: 100,
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2
    },
    // H264 first so browsers that can hardware-encode it prefer it over
    // software VP8 — much lower CPU on the streamer, which is the usual
    // cause of laggy screen share.
    {
        kind: 'video',
        preferredPayloadType: 96,
        mimeType: 'video/H264',
        clockRate: 90000,
        parameters: {
            'packetization-mode': 1,
            'profile-level-id': '42e01f',
            'level-asymmetry-allowed': 1
        }
    },
    {
        kind: 'video',
        preferredPayloadType: 97,
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: { 'x-google-start-bitrate': 1000 }
    }
];

// Peers are keyed by peerId (the socket id), NOT userId, so the same user
// signed in on two devices gets two independent peers — one can stream and
// the other can view without their transports/producers colliding.
type Peer = {
    peerId: string;
    userId: string;
    sendTransport?: WebRtcTransport;
    recvTransport?: WebRtcTransport;
    producers: Map<string, Producer>;
    consumers: Map<string, Consumer>;
};

type Streamer = { peerId: string; userId: string };

type Room = {
    channelId: string;
    router: Router;
    peers: Map<string, Peer>; // keyed by peerId (socket id)
    streamer: Streamer | null;
};

type TransportInfo = {
    id: string;
    iceParameters: mediasoup.types.IceParameters;
    iceCandidates: mediasoup.types.IceCandidate[];
    dtlsParameters: DtlsParameters;
};

type ProducerInfo = {
    producerId: string;
    peerId: string;
    userId: string;
    kind: MediaKind;
};

const WORKER_LOG_LEVEL: mediasoup.types.WorkerLogLevel = 'warn';

export class StreamingSfu {
    private workers: Worker[] = [];
    private rooms = new Map<string, Room>();
    private nextWorkerIdx = 0;
    private ready = false;

    /** Spin up workers; safe to call once at server startup. */
    async init(numWorkers = 1): Promise<void> {
        if (this.ready) return;
        const rtcMinPort = Number(process.env.MEDIASOUP_RTC_MIN_PORT) || 40000;
        const rtcMaxPort = Number(process.env.MEDIASOUP_RTC_MAX_PORT) || 49999;
        for (let i = 0; i < numWorkers; i++) {
            const worker = await mediasoup.createWorker({
                logLevel: WORKER_LOG_LEVEL,
                rtcMinPort,
                rtcMaxPort
            });
            worker.on('died', () => {
                // mediasoup worker crashed; log and let the process restart.
                // eslint-disable-next-line no-console
                console.error(
                    `mediasoup worker pid=${worker.pid} died; exiting in 2s`
                );
                setTimeout(() => process.exit(1), 2000);
            });
            this.workers.push(worker);
        }
        this.ready = true;
    }

    private nextWorker(): Worker {
        const w = this.workers[this.nextWorkerIdx % this.workers.length];
        this.nextWorkerIdx += 1;
        return w;
    }

    private async getOrCreateRoom(channelId: string): Promise<Room> {
        let room = this.rooms.get(channelId);
        if (!room) {
            const router = await this.nextWorker().createRouter({
                mediaCodecs: MEDIA_CODECS
            });
            room = {
                channelId,
                router,
                peers: new Map(),
                streamer: null
            };
            this.rooms.set(channelId, room);
        }
        return room;
    }

    private getOrCreatePeer(room: Room, peerId: string, userId: string): Peer {
        let peer = room.peers.get(peerId);
        if (!peer) {
            peer = {
                peerId,
                userId,
                producers: new Map(),
                consumers: new Map()
            };
            room.peers.set(peerId, peer);
        }
        return peer;
    }

    /** Caller fetches router caps to initialize their Device. */
    async getRouterRtpCapabilities(
        channelId: string
    ): Promise<RtpCapabilities> {
        const room = await this.getOrCreateRoom(channelId);
        return room.router.rtpCapabilities;
    }

    /**
     * Claim the single streamer slot for this connection. Returns false if
     * another *live* connection holds it. A slot held by a peer that has since
     * disconnected (no longer in room.peers) is treated as stale and stolen,
     * so a dropped streamer or a missed streamerChanged broadcast can't wedge
     * the channel shut forever.
     */
    claimStreamer(channelId: string, peerId: string, userId: string): boolean {
        const room = this.rooms.get(channelId);
        if (!room) return false;
        // Free a stale slot whose holder's connection is gone.
        if (room.streamer && !room.peers.has(room.streamer.peerId)) {
            room.streamer = null;
        }
        if (room.streamer && room.streamer.peerId !== peerId) {
            return false;
        }
        room.streamer = { peerId, userId };
        return true;
    }

    releaseStreamerIfHeld(channelId: string, peerId: string): boolean {
        const room = this.rooms.get(channelId);
        if (!room) return false;
        if (!room.streamer || room.streamer.peerId !== peerId) return false;
        room.streamer = null;
        // Close all of this peer's producers; consumers on other peers
        // will close themselves and the server emits producerClosed.
        const peer = room.peers.get(peerId);
        if (peer) {
            for (const p of peer.producers.values()) {
                try {
                    p.close();
                } catch {
                    // best effort
                }
            }
            peer.producers.clear();
        }
        return true;
    }

    /** The userId of the active streamer (for display), if any. */
    getStreamerUserId(channelId: string): string | null {
        return this.rooms.get(channelId)?.streamer?.userId ?? null;
    }

    /** Is this specific connection the active streamer of the channel? */
    isStreamer(channelId: string, peerId: string): boolean {
        const room = this.rooms.get(channelId);
        return !!room && !!room.streamer && room.streamer.peerId === peerId;
    }

    /** List currently-published producers (so a new viewer can subscribe). */
    listProducers(channelId: string): ProducerInfo[] {
        const room = this.rooms.get(channelId);
        if (!room) return [];
        const out: ProducerInfo[] = [];
        for (const peer of room.peers.values()) {
            for (const p of peer.producers.values()) {
                if (!p.closed) {
                    out.push({
                        producerId: p.id,
                        peerId: peer.peerId,
                        userId: peer.userId,
                        kind: p.kind
                    });
                }
            }
        }
        return out;
    }

    async createWebRtcTransport(
        channelId: string,
        peerId: string,
        userId: string,
        direction: 'send' | 'recv'
    ): Promise<TransportInfo> {
        const room = await this.getOrCreateRoom(channelId);
        const peer = this.getOrCreatePeer(room, peerId, userId);

        const announcedIp = process.env.MEDIASOUP_ANNOUNCED_IP || undefined;
        const listenIp = process.env.MEDIASOUP_LISTEN_IP || '0.0.0.0';

        const transport = await room.router.createWebRtcTransport({
            listenIps: [{ ip: listenIp, announcedIp }],
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
            initialAvailableOutgoingBitrate: 1_000_000
        });

        if (direction === 'send') {
            peer.sendTransport?.close();
            peer.sendTransport = transport;
        } else {
            peer.recvTransport?.close();
            peer.recvTransport = transport;
        }

        return {
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters
        };
    }

    async connectTransport(
        channelId: string,
        peerId: string,
        transportId: string,
        dtlsParameters: DtlsParameters
    ): Promise<void> {
        const peer = this.peerOrThrow(channelId, peerId);
        const t = this.findTransport(peer, transportId);
        await t.connect({ dtlsParameters });
    }

    async produce(
        channelId: string,
        peerId: string,
        transportId: string,
        kind: MediaKind,
        rtpParameters: RtpParameters
    ): Promise<{ producerId: string }> {
        const room = this.rooms.get(channelId);
        if (!room) throw new Error('room not found');
        if (!room.streamer || room.streamer.peerId !== peerId) {
            throw new Error('not the active streamer');
        }
        const peer = this.peerOrThrow(channelId, peerId);
        const t = peer.sendTransport;
        if (!t || t.id !== transportId) {
            throw new Error('send transport not found');
        }
        const producer = await t.produce({ kind, rtpParameters });
        peer.producers.set(producer.id, producer);
        producer.on('transportclose', () => {
            peer.producers.delete(producer.id);
        });
        return { producerId: producer.id };
    }

    /**
     * Create a paused Consumer for the given producer. Caller is
     * expected to resume after wiring it up on the client.
     */
    async consume(
        channelId: string,
        peerId: string,
        producerId: string,
        rtpCapabilities: RtpCapabilities
    ): Promise<{
        id: string;
        producerId: string;
        kind: MediaKind;
        rtpParameters: RtpParameters;
    }> {
        const room = this.rooms.get(channelId);
        if (!room) throw new Error('room not found');
        if (!room.router.canConsume({ producerId, rtpCapabilities })) {
            throw new Error('cannot consume');
        }
        const peer = this.peerOrThrow(channelId, peerId);
        const t = peer.recvTransport;
        if (!t) throw new Error('recv transport not found');

        const consumer = await t.consume({
            producerId,
            rtpCapabilities,
            paused: true
        });
        peer.consumers.set(consumer.id, consumer);

        consumer.on('producerclose', () => {
            peer.consumers.delete(consumer.id);
        });
        consumer.on('transportclose', () => {
            peer.consumers.delete(consumer.id);
        });

        return {
            id: consumer.id,
            producerId: consumer.producerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters
        };
    }

    async resumeConsumer(
        channelId: string,
        peerId: string,
        consumerId: string
    ): Promise<void> {
        const peer = this.peerOrThrow(channelId, peerId);
        const c = peer.consumers.get(consumerId);
        if (!c) return;
        await c.resume();
    }

    /** Close everything this connection holds in this channel. */
    leaveRoom(channelId: string, peerId: string): void {
        const room = this.rooms.get(channelId);
        if (!room) return;
        const peer = room.peers.get(peerId);
        if (peer) {
            for (const p of peer.producers.values()) p.close();
            for (const c of peer.consumers.values()) c.close();
            peer.sendTransport?.close();
            peer.recvTransport?.close();
            room.peers.delete(peerId);
        }
        if (room.streamer && room.streamer.peerId === peerId) {
            room.streamer = null;
        }
        if (room.peers.size === 0) {
            // Last peer left; dispose the router so we don't leak memory.
            try {
                room.router.close();
            } catch {
                // best effort
            }
            this.rooms.delete(channelId);
        }
    }

    private peerOrThrow(channelId: string, peerId: string): Peer {
        const room = this.rooms.get(channelId);
        if (!room) throw new Error('room not found');
        const peer = room.peers.get(peerId);
        if (!peer) throw new Error('peer not in room');
        return peer;
    }

    private findTransport(peer: Peer, transportId: string): WebRtcTransport {
        if (peer.sendTransport?.id === transportId) return peer.sendTransport;
        if (peer.recvTransport?.id === transportId) return peer.recvTransport;
        throw new Error('transport not found');
    }
}

export const streamingSfu = new StreamingSfu();
