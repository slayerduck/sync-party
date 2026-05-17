import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { v4 as uuid } from 'uuid';

import { MediaItem } from '../models/MediaItem.js';
import { Party } from '../models/Party.js';
import { updatePartyItems } from '../database/generalOperations.js';
import {
    probeTracks,
    pickDefaultAudio,
    pickDefaultSubtitle,
    shouldBurnInByDefault
} from '../ffmpegHelper.js';
import { queueConversion } from '../conversionRunner.js';

import type { Request, Response } from 'express';
import type { Logger } from 'winston';
import type { TrackInfo, VideoInfo } from '../ffmpegHelper.js';

// ---------- Multer setup (upload to _pending) ----------

const pendingDir = () => path.resolve('data/uploads/_pending');

const ensurePendingDir = () => {
    if (!fs.existsSync(pendingDir())) {
        fs.mkdirSync(pendingDir(), { recursive: true });
    }
};

const pendingStorage = multer.diskStorage({
    destination: (req, file, callback) => {
        ensurePendingDir();
        callback(null, pendingDir());
    },
    filename: (req: Request, file, callback) => {
        const id = uuid();
        callback(null, `${id}-${file.originalname}`);
        req.newFileId = id;
    }
});

const uploadPending = multer({
    storage: pendingStorage,
    limits: { fileSize: 25000000000 }
}).single('file');

// ---------- In-memory pending state ----------

type PendingConversion = {
    sourcePath: string;
    originalName: string;
    owner: string;
    tracks: { audio: TrackInfo[]; subtitle: TrackInfo[] };
    video?: VideoInfo;
    duration?: number;
    createdAt: number;
};

const PENDING_TTL_MS = 60 * 60 * 1000; // 1h
const pending = new Map<string, PendingConversion>();

const sweepPending = () => {
    const now = Date.now();
    for (const [id, entry] of pending.entries()) {
        if (now - entry.createdAt > PENDING_TTL_MS) {
            try {
                if (fs.existsSync(entry.sourcePath))
                    fs.unlinkSync(entry.sourcePath);
            } catch {
                // best effort
            }
            pending.delete(id);
        }
    }
};

// ---------- Endpoints ----------

const uploadForConversion = (req: Request, res: Response, logger: Logger) => {
    uploadPending(req, res, async (err) => {
        if (err) {
            logger.log('error', 'Multer error uploading conversion file', err);
            return res.status(500).json({ success: false, msg: 'uploadError' });
        }
        if (!req.file || !req.user) {
            return res
                .status(400)
                .json({ success: false, msg: 'noFileUploaded' });
        }

        try {
            sweepPending();

            const sourcePath = req.file.path;
            const tracks = await probeTracks(sourcePath);

            const defaultAudio = pickDefaultAudio(tracks.audio);
            const defaultSub = pickDefaultSubtitle(tracks.subtitle);
            const burnDefault = shouldBurnInByDefault(defaultAudio);

            const pendingId = req.newFileId || uuid();
            pending.set(pendingId, {
                sourcePath,
                originalName: req.file.originalname,
                owner: req.user.id,
                tracks: { audio: tracks.audio, subtitle: tracks.subtitle },
                video: tracks.video,
                duration: tracks.duration,
                createdAt: Date.now()
            });

            return res.status(200).json({
                success: true,
                pendingId,
                originalName: req.file.originalname,
                duration: tracks.duration || null,
                tracks: {
                    audio: tracks.audio,
                    subtitle: tracks.subtitle
                },
                defaults: {
                    audioIndex: defaultAudio ? defaultAudio.index : null,
                    subtitleIndex: defaultSub ? defaultSub.index : null,
                    burnSubtitles: burnDefault && defaultSub !== null
                }
            });
        } catch (probeErr) {
            logger.log('error', 'ffprobe failed', probeErr);
            try {
                if (req.file && fs.existsSync(req.file.path))
                    fs.unlinkSync(req.file.path);
            } catch {
                // best effort
            }
            return res.status(500).json({ success: false, msg: 'probeError' });
        }
    });
};

const finalizeConversion = async (
    req: Request,
    res: Response,
    logger: Logger
) => {
    try {
        if (!req.user) {
            return res
                .status(401)
                .json({ success: false, msg: 'unauthorized' });
        }

        const pendingId = req.params.pendingId;
        const entry = pending.get(pendingId);

        if (!entry) {
            return res
                .status(404)
                .json({ success: false, msg: 'pendingNotFound' });
        }
        if (entry.owner !== req.user.id) {
            return res.status(403).json({ success: false, msg: 'notOwner' });
        }

        const { name, partyId, audioIndex, subtitleIndex, burnSubtitles } =
            req.body as {
                name: string;
                partyId: string;
                audioIndex: number;
                subtitleIndex: number | null;
                burnSubtitles: boolean;
            };

        if (
            typeof name !== 'string' ||
            name.length === 0 ||
            name.length > 256 ||
            typeof partyId !== 'string' ||
            typeof audioIndex !== 'number'
        ) {
            return res
                .status(400)
                .json({ success: false, msg: 'validationError' });
        }

        const party = await Party.findOne({ where: { id: partyId } });
        if (
            !party ||
            !party.members.includes(req.user.id) ||
            (party.status !== 'active' && req.user.role !== 'admin')
        ) {
            return res
                .status(403)
                .json({ success: false, msg: 'noPartyAccess' });
        }

        const audioTrack = entry.tracks.audio.find(
            (t) => t.index === audioIndex
        );
        if (!audioTrack) {
            return res
                .status(400)
                .json({ success: false, msg: 'invalidAudioTrack' });
        }

        let subAbsoluteIndex: number | null = null;
        let subOrdinal: number | null = null;
        if (typeof subtitleIndex === 'number') {
            const idx = entry.tracks.subtitle.findIndex(
                (t) => t.index === subtitleIndex
            );
            if (idx === -1) {
                return res.status(400).json({
                    success: false,
                    msg: 'invalidSubtitleTrack'
                });
            }
            subAbsoluteIndex = subtitleIndex;
            subOrdinal = idx;
        }

        const itemId = uuid();
        const safeName = name.replace(/[^\w.\-]+/g, '_');
        const outputFilename = `${itemId}-${safeName}.mp4`;
        const outputPath = path.join(
            path.resolve('data/uploads'),
            outputFilename
        );

        const dbItem = await MediaItem.create({
            id: itemId,
            type: 'file',
            owner: req.user.id,
            name,
            url: outputFilename,
            settings: { status: 'converting' }
        });

        await updatePartyItems(party.id, dbItem.id);

        const sourcePath = entry.sourcePath;
        pending.delete(pendingId);

        queueConversion({
            itemId,
            sourcePath,
            outputPath,
            audioStreamIndex: audioTrack.index,
            subtitleStreamIndex: burnSubtitles ? null : subAbsoluteIndex,
            subtitleOrdinal: burnSubtitles ? subOrdinal : null,
            burnSubtitles: !!burnSubtitles && subOrdinal !== null,
            videoInfo: entry.video,
            audioInfo: audioTrack,
            duration: entry.duration,
            logger,
            label: name
        });

        return res
            .status(200)
            .json({ success: true, msg: 'conversionStarted', itemId });
    } catch (err) {
        logger.log('error', 'finalizeConversion error', err);
        return res.status(500).json({ success: false, msg: 'conversionError' });
    }
};

const cancelPending = (req: Request, res: Response) => {
    if (!req.user)
        return res.status(401).json({ success: false, msg: 'unauthorized' });

    const pendingId = req.params.pendingId;
    const entry = pending.get(pendingId);
    if (entry && entry.owner === req.user.id) {
        try {
            if (fs.existsSync(entry.sourcePath))
                fs.unlinkSync(entry.sourcePath);
        } catch {
            // best effort
        }
        pending.delete(pendingId);
    }
    return res.status(200).json({ success: true });
};

export const conversionController = {
    uploadForConversion,
    finalizeConversion,
    cancelPending
};
