import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import { v4 as uuid } from 'uuid';
import express from 'express';
import { CronJob } from 'cron';
import { ExpressPeerServer } from 'peer';
import { Server as SocketIoServer } from 'socket.io';

import { setupEnvironment } from './core/environment/environment.js';
import { setupHeaders } from './core/headers/headers.js';
import { useCompression } from './core/performance/performance.js';
import { setupRequestParsers } from './core/requestParsers/requestParsers.js';
import { setupSession } from './core/session/session.js';
import { createGeneralLogger } from './core/logger/generalLogger.js';
import { createDatabase } from './core/database/database.js';
import { setupAuthentication } from './core/authentication/setup.js';
import { createRateLimiter } from './core/rateLimiting/rateLimiting.js';

import dbConfig from './dbConfig.cjs';
import { initModels } from './database/initModels.js';
import { Party } from './models/Party.js';
import { User } from './models/User.js';

import { pathConfig, requiredEnvVars, validEnvValues } from './constants.js';

import {
    mustBeAdmin,
    mustBeAuthenticated
} from './core/authentication/middleware.js';
import { authenticateSocketRequest } from './middleware/socketMiddleware.js';

import { authController } from './controllers/authController.js';
import { fileController } from './controllers/fileController.js';
import os from 'os';

import { conversionController } from './controllers/conversionController.js';
import { zipUploadController } from './controllers/zipUploadController.js';
import { getConversionProgress } from './conversionProgress.js';
import { streamingSfu } from './streaming/sfu.js';
import { buildIceServers } from './streaming/iceServers.js';
import { GLOBAL_STREAM_CHANNEL } from '../shared/types.js';
import { MediaItem } from './models/MediaItem.js';
import { mediaItemController } from './controllers/mediaItemController.js';
import { userController } from './controllers/userController.js';
import { partyController } from './controllers/partyController.js';
import { partyItemController } from './controllers/partyItemController.js';
import { partyMetadataController } from './controllers/partyMetadataController.js';
import { userPartyController } from './controllers/userPartyController.js';
import { userItemController } from './controllers/userItemController.js';
import { externalDataController } from './controllers/externalDataController.js';

import type {
    ChatMessage,
    JoinPartyMessage,
    LeavePartyMessage,
    MediaItemUpdateMessage,
    PartyUpdateMessage,
    PlayWish,
    SyncStatus,
    SyncStatusOutgoingMessage,
    DbConfig,
    WebRtcJoinLeaveMessage
} from '../shared/types.js';
import type { Socket } from 'socket.io';

const sslDevCert = fs.readFileSync(
    path.resolve('ssl-dev/server.cert'),
    'utf-8'
);
const sslDevKey = fs.readFileSync(path.resolve('ssl-dev/server.key'), 'utf-8');

setupEnvironment(pathConfig, requiredEnvVars, validEnvValues);

const rateLimiter = createRateLimiter(200);

if (!fs.existsSync(path.resolve('data/uploads'))) {
    fs.mkdirSync(path.resolve('data/uploads'), { recursive: true });
}

if (!fs.existsSync(path.resolve('data/uploads/_pending'))) {
    fs.mkdirSync(path.resolve('data/uploads/_pending'), { recursive: true });
}

if (!fs.existsSync(path.resolve('data/uploads/_unzip'))) {
    fs.mkdirSync(path.resolve('data/uploads/_unzip'), { recursive: true });
}

if (!process.env.SERVER_PORT || !process.env.WEBSOCKETS_PORT) {
    throw new Error('SERVER_PORT or WEBSOCKETS_PORT env var missing');
}

const webRtcServerKey = uuid();

const app = express();

const logger = createGeneralLogger(pathConfig);

const sequelize = await createDatabase(dbConfig as DbConfig);

initModels(sequelize);

try {
    await sequelize.sync({ alter: true });
} catch (error) {
    logger.log('error', error);
}

// Streaming SFU (mediasoup workers)
try {
    const workerCount =
        Number(process.env.MEDIASOUP_WORKERS) ||
        Math.max(1, Math.min(2, os.cpus().length));
    await streamingSfu.init(workerCount);
    logger.log(
        'info',
        `mediasoup SFU ready (${workerCount} worker${
            workerCount > 1 ? 's' : ''
        }) pid=${process.pid}`
    );
    // The SFU and the socket.io rooms keep all of their state in this
    // process's memory. Running more than one app instance (e.g. pm2
    // cluster mode) gives each instance its own isolated state, so two
    // users on different instances never see each other's stream. Warn
    // loudly if we detect a multi-instance launch.
    if (
        process.env.NODE_APP_INSTANCE !== undefined &&
        process.env.NODE_APP_INSTANCE !== '0'
    ) {
        logger.log(
            'warn',
            `Detected pm2 cluster instance NODE_APP_INSTANCE=${process.env.NODE_APP_INSTANCE}. The screenshare channel does NOT work across multiple instances — run sync-party as a single instance (pm2 fork mode).`
        );
    }
} catch (sfuErr) {
    logger.log('error', 'mediasoup SFU failed to init', sfuErr);
}

// HTTP(S) SERVER

const server =
    process.env.NODE_ENV === 'development'
        ? https.createServer({ cert: sslDevCert, key: sslDevKey }, app)
        : http.createServer(app);

// DEFAULT VALUES

const persistentValues = fs.existsSync(path.resolve('data/persistence.json'))
    ? JSON.parse(
          fs.readFileSync(path.resolve('data/persistence.json'), 'utf-8')
      )
    : {
          currentPlayWishes: {},
          lastPositions: {}
      };

const currentSyncStatus: {
    [partyId: string]: { [userId: string]: SyncStatus };
} = {};

const currentPlayWishes: {
    [partyId: string]: PlayWish;
} = persistentValues.currentPlayWishes;

const lastPositions: {
    [partyId: string]: { [itemId: string]: number };
} = persistentValues.lastPositions;

new CronJob(
    '*/15 * * * *',
    () => {
        fs.writeFileSync(
            path.resolve('data/persistence.json'),
            JSON.stringify({
                currentPlayWishes,
                lastPositions
            })
        );
    },
    null,
    false
).start();

// MIDDLEWARE

setupHeaders(app, {
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            baseUri: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            scriptSrc:
                "'self' 'unsafe-inline' www.youtube.com s.ytimg.com player.vimeo.com w.soundcloud.com",
            connectSrc: ["'self' *"],
            mediaSrc: ['*'],
            frameSrc: ['www.youtube.com w.soundcloud.com player.vimeo.com'],
            scriptSrcAttr: ["'none'"],
            styleSrc: "'self' https: 'unsafe-inline'"
        }
    }
});

useCompression(app);

// HTTP HEADERS

// TODO: Consider cors package

app.use((req, res, next) => {
    res.header('Cross-Origin-Resource-Policy', 'cross-origin');
    res.header('Cross-Origin-Embedder-Policy', 'unsafe-none');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header(
        'Access-Control-Allow-Headers',
        'X-Requested-With, Authorization, Content-Type, Accept, X-CSRF-Token'
    );
    res.header(
        'Access-Control-Allow-Methods',
        'POST, GET, DELETE, OPTIONS, PUT'
    );

    next();
});

app.use(rateLimiter);

// Static files middleware
app.use(express.static(path.resolve('build/public')));

setupRequestParsers(app);

// Session & Auth

const { sessionMiddleware } = setupSession(
    app,
    sequelize,
    365 * 24 * 60 * 60 * 1000
);

const { passport } = setupAuthentication(app);

// TBI
// app.use(
//     csurf({
//         cookie: { key: '_csrf', signed: false }
//     })
// );

// CSRF Error Handler
// app.use((err, req, res, next) => {
//     if (err.code !== 'EBADCSRFTOKEN') return next(err);
//     logger.log(
//         'info',
//         `Invalid CSRF token. User ID: ${
//             req.user ? req.user.id : '(no session)'
//         }`
//     );
//     return res.status(403).json({
//         success: false,
//         msg: 'csrfToken'
//     });
// });

// WEBSOCKETS SERVER

const socketServer =
    process.env.NODE_ENV === 'development'
        ? https.createServer({
              key: sslDevKey,
              cert: sslDevCert
          })
        : http.createServer();

const io = new SocketIoServer(socketServer, {
    transports: ['websocket'],
    cors:
        process.env.NODE_ENV === 'development'
            ? {
                  origin: 'https://localhost:3000',
                  methods: ['GET']
              }
            : undefined
});

authenticateSocketRequest(io, sessionMiddleware, passport);

// Socket listeners
io.on('connection', (socket: Socket) => {
    // @ts-ignore Fixme user on request
    const socketUserId = socket.request.user.id;

    logger.log('info', `Web Sockets: New connection, userId: ${socketUserId}`);

    const joinParty = async (data: { partyId: string; timestamp: number }) => {
        const members: Set<string> = await io.in(data.partyId).allSockets();

        if (!members.has(socketUserId)) {
            try {
                const party = await Party.findOne({
                    where: {
                        id: data.partyId
                    }
                });

                if (!party || !party.members.includes(socketUserId)) {
                    return Promise.reject(
                        new Error('User not member in party')
                    );
                }
            } catch (error) {
                logger.log('error', error);
            }

            socket.join(data.partyId);

            socket.emit('serverTimeOffset', Date.now() - data.timestamp);

            logger.log(
                'info',
                `Web Sockets: User ${socketUserId} joined party ${data.partyId}`
            );

            if (currentPlayWishes[data.partyId]) {
                socket.emit('playOrder', currentPlayWishes[data.partyId]);
            }

            return Promise.resolve();
        } else {
            return Promise.reject(new Error('User already joined the party'));
        }
    };

    socket.on('joinParty', async (data: JoinPartyMessage) => {
        await joinParty(data);
    });

    socket.on('leaveParty', (data: LeavePartyMessage) => {
        socket.leave(data.partyId);

        logger.log(
            'info',
            `Web Sockets: User ${socketUserId} left party ${data.partyId}`
        );
    });

    socket.on('playWish', (playWish: PlayWish) => {
        const playWishWithNormalizedTimestamp = {
            ...playWish,
            timestamp: playWish.timestamp + (Date.now() - playWish.timestamp)
        };

        // Save position of previous item, if delivered
        if (playWish.lastPosition && playWish.lastPosition.position > 0) {
            if (!lastPositions[playWish.partyId]) {
                lastPositions[playWish.partyId] = {};
            }

            lastPositions[playWish.partyId][playWish.lastPosition.itemId] =
                playWish.lastPosition.position;
        }

        // Attach last position of the requested item
        if (
            playWishWithNormalizedTimestamp.requestLastPosition &&
            lastPositions[playWish.partyId] &&
            lastPositions[playWish.partyId][
                playWishWithNormalizedTimestamp.mediaItemId
            ]
        ) {
            playWishWithNormalizedTimestamp.lastPosition = {
                itemId: playWishWithNormalizedTimestamp.mediaItemId,
                position:
                    lastPositions[playWishWithNormalizedTimestamp.partyId][
                        playWishWithNormalizedTimestamp.mediaItemId
                    ]
            };
        } else {
            if (playWishWithNormalizedTimestamp.lastPosition) {
                delete playWishWithNormalizedTimestamp.lastPosition;
            }
        }

        currentPlayWishes[playWish.partyId] = playWishWithNormalizedTimestamp;
        // Only emitted to party members
        io.to(playWish.partyId).emit(
            'playOrder',
            playWishWithNormalizedTimestamp
        );
    });

    socket.on('partyUpdate', (partyUpdateData: PartyUpdateMessage) => {
        // Update emitted to all connected users, in order to make sure dashboard is updated etc.
        io.emit('partyUpdate', partyUpdateData);
    });

    socket.on('mediaItemUpdate', (empty: MediaItemUpdateMessage) => {
        // Update emitted to all connected users, in order to make sure dashboard is updated etc.
        io.emit('mediaItemUpdate', empty);
    });

    socket.on('syncStatus', (userSyncStatus: SyncStatusOutgoingMessage) => {
        currentSyncStatus[userSyncStatus.partyId] =
            currentSyncStatus[userSyncStatus.partyId] || {};
        currentSyncStatus[userSyncStatus.partyId][userSyncStatus.userId] = {
            isPlaying: userSyncStatus.isPlaying,
            timestamp: userSyncStatus.timestamp,
            position: userSyncStatus.position,
            serverTimeOffset: Date.now() - userSyncStatus.timestamp,
            webRtc: userSyncStatus.webRtc
        };

        // Only emitted to party members
        io.to(userSyncStatus.partyId).emit(
            'syncStatus',
            currentSyncStatus[userSyncStatus.partyId]
        );
    });

    socket.on('chatMessage', (chatMessage: ChatMessage) => {
        io.to(chatMessage.partyId).emit('chatMessage', chatMessage);
    });

    // WebRTC
    socket.on('joinWebRtc', (data: WebRtcJoinLeaveMessage) => {
        io.to(data.partyId).emit('joinWebRtc', data.webRtcId);
    });

    socket.on('leaveWebRtc', (data: WebRtcJoinLeaveMessage) => {
        io.to(data.partyId).emit('leaveWebRtc', {
            webRtcId: data.webRtcId
        });
    });

    // -------- Screen-sharing channel (mediasoup SFU) --------

    const streamingPartyIds = new Set<string>();

    const ack = (cb: unknown, payload: unknown): void => {
        if (typeof cb === 'function') {
            (cb as (p: unknown) => void)(payload);
        }
    };

    // Streaming operations are gated on access: real party membership for
    // party channels (so a logged-in user can't tap a party's stream by
    // guessing its id), and open to any authenticated user for the single
    // global screenshare channel.
    const isPartyMember = async (partyId: string): Promise<boolean> => {
        try {
            const party = await Party.findOne({ where: { id: partyId } });
            return !!party && party.members.includes(socketUserId);
        } catch {
            return false;
        }
    };

    const canAccessChannel = async (channelId: string): Promise<boolean> => {
        if (channelId === GLOBAL_STREAM_CHANNEL) return true;
        return isPartyMember(channelId);
    };

    socket.on(
        'streaming:join',
        async (data: { partyId: string }, cb?: unknown) => {
            try {
                if (!(await canAccessChannel(data.partyId))) {
                    ack(cb, { ok: false, error: 'no channel access' });
                    return;
                }
                // The global channel has no party room to piggyback on, so
                // join it explicitly to receive room broadcasts.
                if (data.partyId === GLOBAL_STREAM_CHANNEL) {
                    socket.join(data.partyId);
                }
                const rtpCapabilities =
                    await streamingSfu.getRouterRtpCapabilities(data.partyId);
                streamingPartyIds.add(data.partyId);
                // Exclude only this connection's own producers (by socket id),
                // so a second device of the same user still sees the stream.
                const producers = streamingSfu
                    .listProducers(data.partyId)
                    .filter((p) => p.peerId !== socket.id);
                const roomSize = (await io.in(data.partyId).allSockets()).size;
                logger.log(
                    'info',
                    `streaming:join channel=${
                        data.partyId
                    } user=${socketUserId} peer=${socket.id} pid=${
                        process.pid
                    } roomSockets=${roomSize} currentStreamer=${streamingSfu.getStreamerUserId(
                        data.partyId
                    )}`
                );
                ack(cb, {
                    ok: true,
                    rtpCapabilities,
                    streamerUserId: streamingSfu.getStreamerUserId(
                        data.partyId
                    ),
                    producers
                });
            } catch (err) {
                ack(cb, { ok: false, error: String(err) });
            }
        }
    );

    socket.on(
        'streaming:claimStreamer',
        async (data: { partyId: string }, cb?: unknown) => {
            if (!(await canAccessChannel(data.partyId))) {
                ack(cb, { ok: false });
                return;
            }
            const ok = streamingSfu.claimStreamer(
                data.partyId,
                socket.id,
                socketUserId
            );
            if (ok) {
                io.to(data.partyId).emit('streaming:streamerChanged', {
                    partyId: data.partyId,
                    streamerUserId: socketUserId
                });
            }
            const roomSize = (await io.in(data.partyId).allSockets()).size;
            logger.log(
                'info',
                `streaming:claimStreamer channel=${data.partyId} user=${socketUserId} peer=${socket.id} granted=${ok} pid=${process.pid} broadcastTo=${roomSize} sockets`
            );
            ack(cb, { ok });
        }
    );

    socket.on(
        'streaming:releaseStreamer',
        (data: { partyId: string }, cb?: unknown) => {
            const released = streamingSfu.releaseStreamerIfHeld(
                data.partyId,
                socket.id
            );
            if (released) {
                io.to(data.partyId).emit('streaming:streamerChanged', {
                    partyId: data.partyId,
                    streamerUserId: null
                });
            }
            ack(cb, { ok: true });
        }
    );

    socket.on(
        'streaming:createTransport',
        async (
            data: { partyId: string; direction: 'send' | 'recv' },
            cb?: unknown
        ) => {
            try {
                const info = await streamingSfu.createWebRtcTransport(
                    data.partyId,
                    socket.id,
                    socketUserId,
                    data.direction
                );
                ack(cb, { ok: true, transport: info });
            } catch (err) {
                ack(cb, { ok: false, error: String(err) });
            }
        }
    );

    socket.on(
        'streaming:connectTransport',
        async (
            data: {
                partyId: string;
                transportId: string;
                // mediasoup-client DtlsParameters
                dtlsParameters: Parameters<
                    typeof streamingSfu.connectTransport
                >[3];
            },
            cb?: unknown
        ) => {
            try {
                await streamingSfu.connectTransport(
                    data.partyId,
                    socket.id,
                    data.transportId,
                    data.dtlsParameters
                );
                ack(cb, { ok: true });
            } catch (err) {
                ack(cb, { ok: false, error: String(err) });
            }
        }
    );

    socket.on(
        'streaming:produce',
        async (
            data: {
                partyId: string;
                transportId: string;
                kind: 'audio' | 'video';
                rtpParameters: Parameters<typeof streamingSfu.produce>[4];
            },
            cb?: unknown
        ) => {
            try {
                const result = await streamingSfu.produce(
                    data.partyId,
                    socket.id,
                    data.transportId,
                    data.kind,
                    data.rtpParameters
                );
                io.to(data.partyId).emit('streaming:newProducer', {
                    partyId: data.partyId,
                    producer: {
                        producerId: result.producerId,
                        userId: socketUserId,
                        kind: data.kind
                    }
                });
                ack(cb, { ok: true, producerId: result.producerId });
            } catch (err) {
                ack(cb, { ok: false, error: String(err) });
            }
        }
    );

    socket.on(
        'streaming:consume',
        async (
            data: {
                partyId: string;
                producerId: string;
                rtpCapabilities: Parameters<typeof streamingSfu.consume>[3];
            },
            cb?: unknown
        ) => {
            try {
                const c = await streamingSfu.consume(
                    data.partyId,
                    socket.id,
                    data.producerId,
                    data.rtpCapabilities
                );
                ack(cb, { ok: true, consumer: c });
            } catch (err) {
                ack(cb, { ok: false, error: String(err) });
            }
        }
    );

    socket.on(
        'streaming:resumeConsumer',
        async (data: { partyId: string; consumerId: string }, cb?: unknown) => {
            try {
                await streamingSfu.resumeConsumer(
                    data.partyId,
                    socket.id,
                    data.consumerId
                );
                ack(cb, { ok: true });
            } catch (err) {
                ack(cb, { ok: false, error: String(err) });
            }
        }
    );

    socket.on('streaming:leave', (data: { partyId: string }) => {
        const wasStreamer = streamingSfu.isStreamer(data.partyId, socket.id);
        streamingSfu.leaveRoom(data.partyId, socket.id);
        streamingPartyIds.delete(data.partyId);
        // The global channel was joined explicitly; leave its room so we
        // stop receiving its broadcasts. Party rooms stay (used elsewhere).
        if (data.partyId === GLOBAL_STREAM_CHANNEL) {
            socket.leave(data.partyId);
        }
        if (wasStreamer) {
            io.to(data.partyId).emit('streaming:streamerChanged', {
                partyId: data.partyId,
                streamerUserId: null
            });
        }
    });

    socket.on('disconnect', () => {
        for (const partyId of streamingPartyIds) {
            const wasStreamer = streamingSfu.isStreamer(partyId, socket.id);
            streamingSfu.leaveRoom(partyId, socket.id);
            if (wasStreamer) {
                io.to(partyId).emit('streaming:streamerChanged', {
                    partyId,
                    streamerUserId: null
                });
            }
        }
        streamingPartyIds.clear();
    });

    // Disconnect
    socket.on('disconnected', () => {
        logger.log('info', `Web Sockets: User disconnected: ${socketUserId}`);
    });
});

// WebRTC

const peerServer = ExpressPeerServer(server, {
    // debug: true,
    key: webRtcServerKey
});

app.use('/peerjs', mustBeAuthenticated, peerServer);

peerServer.on('connection', async (client) => {
    const requestWebRtcId = client.getId();
    const allParties = await Party.findAll();
    let isInActiveParty = false;
    let userId = '';

    for (const party of allParties) {
        const partyWebRtcIds = party.settings.webRtcIds;

        if (partyWebRtcIds) {
            for (const partyUserId of Object.keys(partyWebRtcIds)) {
                const partyUserWebRtcId = partyWebRtcIds[partyUserId];

                if (
                    partyUserWebRtcId === requestWebRtcId ||
                    party.status === 'active'
                ) {
                    isInActiveParty = true;
                    userId = partyUserId;
                    break;
                }
            }
        }

        if (isInActiveParty) {
            break;
        }
    }

    const user = await User.findOne({
        where: { id: userId }
    });

    if (!isInActiveParty || !user) {
        client.getSocket()?.close();
        logger.log('error', `PeerJS: Client denied: ${requestWebRtcId}`);

        return;
    }

    logger.log(
        'info',
        `PeerJS: client connected: ${requestWebRtcId} (userId: ${user.id}, username: ${user.username})`
    );
});

peerServer.on('disconnect', (client) => {
    logger.log('info', `PeerJS: client disconnected: ${client.getId()}`);
});

// API Endpoints

// Auth & login

app.post('/api/auth', async (req, res) => {
    await authController.auth(req, res, logger);
});

app.post('/api/login', passport.authenticate('local'), (req, res) => {
    authController.login(req, res);
});

app.post('/api/logout', mustBeAuthenticated, async (req, res) => {
    await authController.logout(req, res, logger);
});

// WebRTC Key
app.post('/api/webRtcServerKey', mustBeAuthenticated, async (req, res) => {
    const partyId = req.body.partyId;
    const userId = req.body.userId;
    const webRtcId = req.body.webRtcId;
    const party = await Party.findOne({
        where: { id: partyId }
    });
    const user = await User.findOne({
        where: { id: userId }
    });

    if (
        !party ||
        party.settings.webRtcIds[userId] !== webRtcId ||
        !party.members.includes(userId) ||
        !user
    ) {
        return res.status(401);
    }

    return res.json({ webRtcServerKey });
});

// MediaItems

app.get(
    '/api/allMediaItems',
    mustBeAuthenticated,
    mustBeAdmin,
    async (req, res) => {
        await mediaItemController.getAllMediaItems(req, res, logger);
    }
);

app.post('/api/mediaItem', mustBeAuthenticated, async (req, res) => {
    await mediaItemController.createMediaItem(req, res, logger);
});

app.put('/api/mediaItem/:id', mustBeAuthenticated, async (req, res) => {
    await mediaItemController.editMediaItem(req, res, logger);
});

app.delete('/api/mediaItem/:id', mustBeAuthenticated, async (req, res) => {
    await mediaItemController.deleteMediaItem(req, res, logger);
});

// UserItems

app.get('/api/userItems', mustBeAuthenticated, async (req, res) => {
    await userItemController.getUserItems(req, res, logger);
});

// Files

app.get('/api/file/:id', mustBeAuthenticated, async (req, res) => {
    await fileController.getFile(req, res);
});

app.post('/api/file', mustBeAuthenticated, (req, res) => {
    fileController.upload(req, res, logger);
});

app.post('/api/file/zip', mustBeAuthenticated, (req, res) => {
    zipUploadController.uploadZipFile(req, res, logger);
});

app.post(
    '/api/file/zip/:zipJobId/finalize',
    mustBeAuthenticated,
    async (req, res) => {
        await zipUploadController.finalizeZipConversions(req, res, logger);
    }
);

app.delete('/api/file/zip/:zipJobId', mustBeAuthenticated, (req, res) => {
    zipUploadController.cancelPendingZip(req, res);
});

app.get('/api/pendingZipJobs', mustBeAuthenticated, async (req, res) => {
    await zipUploadController.listPendingZipJobs(req, res);
});

app.post('/api/file/convert', mustBeAuthenticated, (req, res) => {
    conversionController.uploadForConversion(req, res, logger);
});

app.post(
    '/api/file/convert/:pendingId/finalize',
    mustBeAuthenticated,
    async (req, res) => {
        await conversionController.finalizeConversion(req, res, logger);
    }
);

app.delete('/api/file/convert/:pendingId', mustBeAuthenticated, (req, res) => {
    conversionController.cancelPending(req, res);
});

app.post(
    '/api/file/convert/retry/:itemId',
    mustBeAuthenticated,
    async (req, res) => {
        await conversionController.retryFailedConversion(req, res, logger);
    }
);

app.delete(
    '/api/file/convert/failed/:itemId',
    mustBeAuthenticated,
    async (req, res) => {
        await conversionController.discardFailedConversion(req, res);
    }
);

app.get(
    '/api/conversionProgress/:itemId',
    mustBeAuthenticated,
    async (req, res) => {
        const itemId = req.params.itemId;
        const percent = getConversionProgress(itemId);
        let status: string | undefined;
        try {
            const item = await MediaItem.findOne({ where: { id: itemId } });
            status = item?.settings?.status;
        } catch {
            // best effort
        }
        return res.json({
            percent: typeof percent === 'number' ? percent : null,
            status: status ?? null
        });
    }
);

app.get('/api/iceServers', mustBeAuthenticated, (req, res) => {
    const userId = req.user?.id ?? 'anon';
    return res.json({ iceServers: buildIceServers(userId) });
});

// Users

app.get('/api/allUsers', mustBeAuthenticated, mustBeAdmin, async (req, res) => {
    await userController.getAllUsers(req, res);
});

// Parties

app.post('/api/party', mustBeAuthenticated, mustBeAdmin, async (req, res) => {
    await partyController.createParty(req, res, logger);
});

app.put('/api/party', mustBeAuthenticated, mustBeAdmin, async (req, res) => {
    await partyController.editParty(req, res, logger);
});

// User Parties

app.get('/api/userParties', mustBeAuthenticated, async (req, res) => {
    await userPartyController.getUserParties(req, res);
});

// Party items

app.delete('/api/partyItems', mustBeAuthenticated, async (req, res) => {
    await partyItemController.removeItemFromParty(req, res);
});

app.post('/api/partyItems', mustBeAuthenticated, async (req, res) => {
    await partyItemController.addItemToParty(req, res, logger);
});

app.put('/api/partyItems', mustBeAuthenticated, async (req, res) => {
    await partyItemController.updatePartyItems(req, res, logger);
});

// Party metadata

app.put('/api/partyMetadata', mustBeAuthenticated, async (req, res) => {
    await partyMetadataController.updatePartyMetadata(req, res, logger);
});

// Data from external websites

app.post('/api/linkMetadata', mustBeAuthenticated, async (req, res) => {
    await externalDataController.getLinkMetadata(req, res, logger);
});

// Route everything not caught by above routes to index.html
app.get('*', (req, res) => {
    res.sendFile(path.resolve('build/public/index.html'));
});

// Start Websockets server
socketServer.listen(parseInt(process.env.WEBSOCKETS_PORT, 10), () => {
    logger.log(
        'info',
        `Websockets server listening on port ${process.env.WEBSOCKETS_PORT}`
    );
});

// Start server
server.listen(process.env.SERVER_PORT, () => {
    logger.log('info', `App listening on port ${process.env.SERVER_PORT}`);
});
