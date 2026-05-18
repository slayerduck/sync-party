import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import multer from 'multer';
import { v4 as uuid } from 'uuid';

import { MediaItem } from '../models/MediaItem.js';
import { Party } from '../models/Party.js';
import { updatePartyItems } from '../database/generalOperations.js';
import { probeTracks } from '../ffmpegHelper.js';
import { queueConversion } from '../conversionRunner.js';

import type { Request, Response } from 'express';
import type { Logger } from 'winston';
import type { CreationAttributes } from 'sequelize';
import type { ProbedTracks, TrackInfo, VideoInfo } from '../ffmpegHelper.js';

const zipPendingDir = (): string => path.resolve('data/uploads/_pending');

const ensureDir = (p: string): void => {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
};

const tryUnlink = (p: string): void => {
    try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
        // best effort
    }
};

const zipStorage = multer.diskStorage({
    destination: (req, file, callback) => {
        ensureDir(zipPendingDir());
        callback(null, zipPendingDir());
    },
    filename: (req: Request, file, callback) => {
        const id = uuid();
        callback(null, `${id}-${file.originalname}`);
    }
});

const uploadZip = multer({
    storage: zipStorage,
    limits: { fileSize: 25000000000 }
}).single('file');

const MEDIA_EXT_RE =
    /\.(mp4|m4v|mkv|avi|webm|mov|ts|m2ts|wmv|flv|ogv|3gp|vob|mp3|wav|flac|m4a|aac|ogg)$/i;
const PLAYABLE_EXT_RE = /\.(mp4|m4v|webm|mp3|wav|flac|m4a|aac|ogg)$/i;

const stripExt = (name: string): string => name.replace(/\.[^.]+$/, '');
const sanitize = (name: string): string => name.replace(/[^\w.\-]+/g, '_');

const unzipTo = (zipPath: string, destDir: string): Promise<void> => {
    return new Promise((resolve, reject) => {
        const proc = spawn('unzip', ['-q', '-o', zipPath, '-d', destDir]);
        let stderr = '';
        proc.stderr.on('data', (d) => (stderr += d.toString()));
        proc.on('error', (err) => reject(err));
        proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`unzip exited ${code}: ${stderr.trim()}`));
        });
    });
};

const walkFiles = (dir: string): string[] => {
    const out: string[] = [];
    const stack = [dir];
    while (stack.length) {
        const cur = stack.pop()!;
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(cur, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const e of entries) {
            const full = path.join(cur, e.name);
            if (e.isDirectory()) stack.push(full);
            else if (e.isFile()) out.push(full);
        }
    }
    return out;
};

const rmDirSafe = (dir: string): void => {
    try {
        fs.rmSync(dir, { recursive: true, force: true });
    } catch {
        // best effort
    }
};

// ---------- Phase-2 pending state (one entry per zip upload) ----------

type ConvertCandidate = {
    pendingPath: string;
    originalName: string;
    displayName: string;
    itemId: string;
    outputFilename: string;
    outputPath: string;
    probed: ProbedTracks;
};

type PendingZip = {
    owner: string;
    partyId: string;
    candidates: ConvertCandidate[];
    createdAt: number;
};

const PENDING_ZIP_TTL_MS = 60 * 60 * 1000; // 1h
const pendingZips = new Map<string, PendingZip>();

const sweepPendingZips = (): void => {
    const now = Date.now();
    for (const [id, entry] of pendingZips.entries()) {
        if (now - entry.createdAt > PENDING_ZIP_TTL_MS) {
            for (const c of entry.candidates) tryUnlink(c.pendingPath);
            pendingZips.delete(id);
        }
    }
};

const trackInfoForResponse = (
    t: TrackInfo
): {
    index: number;
    codec?: string;
    language?: string;
    title?: string;
} => ({
    index: t.index,
    codec: t.codec,
    language: t.language,
    title: t.title
});

// ---------- Phase 1: upload + unzip + classify ----------

const uploadZipFile = (req: Request, res: Response, logger: Logger): void => {
    uploadZip(req, res, async (err) => {
        if (err) {
            logger.log('error', 'Multer error uploading zip', err);
            return res.status(500).json({ success: false, msg: 'uploadError' });
        }
        if (!req.file || !req.user) {
            return res
                .status(400)
                .json({ success: false, msg: 'noFileUploaded' });
        }

        const partyId = req.body.partyId;
        if (typeof partyId !== 'string') {
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
            tryUnlink(req.file.path);
            return res
                .status(403)
                .json({ success: false, msg: 'noPartyAccess' });
        }

        const zipPath = req.file.path;
        const extractDir = path.join(
            path.resolve('data/uploads/_unzip'),
            uuid()
        );

        try {
            ensureDir(extractDir);
            await unzipTo(zipPath, extractDir);
        } catch (unzipErr) {
            logger.log('error', 'unzip failed', unzipErr);
            tryUnlink(zipPath);
            rmDirSafe(extractDir);
            return res.status(500).json({ success: false, msg: 'unzipError' });
        }

        const files = walkFiles(extractDir).filter((f) => MEDIA_EXT_RE.test(f));

        const addedReady: {
            id: string;
            name: string;
        }[] = [];
        const errors: string[] = [];

        const uploadsDir = path.resolve('data/uploads');
        ensureDir(zipPendingDir());

        const candidates: ConvertCandidate[] = [];

        for (const src of files) {
            const originalName = path.basename(src);
            const displayName = stripExt(originalName) || originalName;
            const itemId = uuid();
            const safeName = sanitize(originalName);
            const safeBase = sanitize(stripExt(originalName) || originalName);
            const needsConversion = !PLAYABLE_EXT_RE.test(originalName);

            if (needsConversion) {
                const pendingPath = path.join(
                    zipPendingDir(),
                    `${itemId}-${safeName}`
                );
                try {
                    fs.renameSync(src, pendingPath);
                } catch {
                    try {
                        fs.copyFileSync(src, pendingPath);
                        fs.unlinkSync(src);
                    } catch (copyErr) {
                        errors.push(String(copyErr));
                        continue;
                    }
                }

                let probed: ProbedTracks;
                try {
                    probed = await probeTracks(pendingPath);
                } catch (probeErr) {
                    logger.log(
                        'error',
                        `probe failed for ${originalName}`,
                        probeErr
                    );
                    errors.push(`${originalName}: probe failed`);
                    tryUnlink(pendingPath);
                    continue;
                }

                if (probed.audio.length === 0) {
                    logger.log(
                        'warn',
                        `Skipping ${originalName}: no audio track`
                    );
                    errors.push(`${originalName}: no audio track`);
                    tryUnlink(pendingPath);
                    continue;
                }

                candidates.push({
                    pendingPath,
                    originalName,
                    displayName,
                    itemId,
                    outputFilename: `${itemId}-${safeBase}.mp4`,
                    outputPath: path.join(
                        uploadsDir,
                        `${itemId}-${safeBase}.mp4`
                    ),
                    probed
                });
            } else {
                const destFilename = `${itemId}-${safeName}`;
                const destPath = path.join(uploadsDir, destFilename);

                try {
                    fs.renameSync(src, destPath);
                } catch {
                    try {
                        fs.copyFileSync(src, destPath);
                        fs.unlinkSync(src);
                    } catch (copyErr) {
                        errors.push(String(copyErr));
                        continue;
                    }
                }

                const newItem: CreationAttributes<MediaItem> = {
                    id: itemId,
                    type: 'file',
                    owner: req.user.id,
                    name: displayName,
                    url: destFilename,
                    settings: { status: 'ready' }
                };

                try {
                    const dbItem = await MediaItem.create(newItem);
                    await updatePartyItems(party.id, dbItem.id);
                    addedReady.push({ id: dbItem.id, name: displayName });
                } catch (dbErr) {
                    logger.log('error', 'Failed to insert zip item', dbErr);
                    errors.push(String(dbErr));
                    tryUnlink(destPath);
                }
            }
        }

        rmDirSafe(extractDir);
        tryUnlink(zipPath);

        sweepPendingZips();

        let pendingZip: {
            zipJobId: string;
            convertCount: number;
            sample: {
                originalName: string;
                duration: number | null;
                tracks: {
                    audio: ReturnType<typeof trackInfoForResponse>[];
                    subtitle: ReturnType<typeof trackInfoForResponse>[];
                };
            };
        } | null = null;

        if (candidates.length > 0) {
            const zipJobId = uuid();
            pendingZips.set(zipJobId, {
                owner: req.user.id,
                partyId: party.id,
                candidates,
                createdAt: Date.now()
            });

            const sample = candidates[0].probed;
            pendingZip = {
                zipJobId,
                convertCount: candidates.length,
                sample: {
                    originalName: candidates[0].originalName,
                    duration: sample.duration ?? null,
                    tracks: {
                        audio: sample.audio.map(trackInfoForResponse),
                        subtitle: sample.subtitle.map(trackInfoForResponse)
                    }
                }
            };
        }

        return res.status(200).json({
            success: true,
            count: addedReady.length,
            addedReady,
            skipped: errors.length,
            pendingZip
        });
    });
};

// ---------- Phase 2: apply track choices, queue conversions ----------

const finalizeZipConversions = async (
    req: Request,
    res: Response,
    logger: Logger
): Promise<Response> => {
    if (!req.user) {
        return res.status(401).json({ success: false, msg: 'unauthorized' });
    }

    const zipJobId = req.params.zipJobId;
    const entry = pendingZips.get(zipJobId);

    if (!entry) {
        return res
            .status(404)
            .json({ success: false, msg: 'pendingZipNotFound' });
    }
    const { audioIndex, subtitleIndex, burnSubtitles } = req.body as {
        audioIndex: number;
        subtitleIndex: number | null;
        burnSubtitles: boolean;
    };

    if (typeof audioIndex !== 'number') {
        return res.status(400).json({ success: false, msg: 'validationError' });
    }

    const party = await Party.findOne({ where: { id: entry.partyId } });
    if (
        !party ||
        !party.members.includes(req.user.id) ||
        (party.status !== 'active' && req.user.role !== 'admin')
    ) {
        return res.status(403).json({ success: false, msg: 'noPartyAccess' });
    }

    pendingZips.delete(zipJobId);

    const queued: { id: string; name: string }[] = [];
    const skipped: string[] = [];

    for (const c of entry.candidates) {
        const audioTrack: TrackInfo | undefined = c.probed.audio.find(
            (t) => t.index === audioIndex
        );
        if (!audioTrack) {
            logger.log(
                'warn',
                `Zip item ${c.originalName} has no audio track ${audioIndex}; skipping`
            );
            skipped.push(c.originalName);
            tryUnlink(c.pendingPath);
            continue;
        }

        let subAbsIndex: number | null = null;
        let subOrdinal: number | null = null;
        if (typeof subtitleIndex === 'number') {
            const idx = c.probed.subtitle.findIndex(
                (t) => t.index === subtitleIndex
            );
            if (idx === -1) {
                // Subtitle track not present in this file; skip burn but
                // still convert without subs.
                subAbsIndex = null;
                subOrdinal = null;
            } else {
                subAbsIndex = subtitleIndex;
                subOrdinal = idx;
            }
        }

        const willBurn = !!burnSubtitles && subOrdinal !== null;

        const videoInfo: VideoInfo | undefined = c.probed.video;

        const newItem: CreationAttributes<MediaItem> = {
            id: c.itemId,
            type: 'file',
            owner: req.user.id,
            name: c.displayName,
            url: c.outputFilename,
            settings: { status: 'converting' }
        };

        try {
            const dbItem = await MediaItem.create(newItem);
            await updatePartyItems(party.id, dbItem.id);
            queued.push({ id: dbItem.id, name: c.displayName });
        } catch (dbErr) {
            logger.log('error', 'Failed to insert zip convert item', dbErr);
            skipped.push(c.originalName);
            tryUnlink(c.pendingPath);
            continue;
        }

        queueConversion({
            itemId: c.itemId,
            sourcePath: c.pendingPath,
            outputPath: c.outputPath,
            audioStreamIndex: audioTrack.index,
            subtitleStreamIndex: willBurn ? null : subAbsIndex,
            subtitleOrdinal: willBurn ? subOrdinal : null,
            burnSubtitles: willBurn,
            videoInfo,
            audioInfo: audioTrack,
            duration: c.probed.duration,
            logger,
            label: c.originalName
        });
    }

    return res.status(200).json({
        success: true,
        queued,
        skipped
    });
};

// ---------- Cancel a phase-1 result the user didn't finalize ----------

const cancelPendingZip = (req: Request, res: Response): Response => {
    if (!req.user) {
        return res.status(401).json({ success: false, msg: 'unauthorized' });
    }
    const zipJobId = req.params.zipJobId;
    const entry = pendingZips.get(zipJobId);
    if (entry) {
        for (const c of entry.candidates) tryUnlink(c.pendingPath);
        pendingZips.delete(zipJobId);
    }
    return res.status(200).json({ success: true });
};

// ---------- List pending phase-1 results for the processing-files page ----------

const listPendingZipJobs = async (
    req: Request,
    res: Response
): Promise<Response> => {
    if (!req.user) {
        return res.status(401).json({ success: false, msg: 'unauthorized' });
    }
    sweepPendingZips();

    const partyNameCache = new Map<string, string>();
    const partyName = async (partyId: string): Promise<string> => {
        if (partyNameCache.has(partyId)) {
            return partyNameCache.get(partyId)!;
        }
        try {
            const p = await Party.findOne({ where: { id: partyId } });
            const name = p?.name ?? '';
            partyNameCache.set(partyId, name);
            return name;
        } catch {
            return '';
        }
    };

    const jobs: {
        zipJobId: string;
        partyId: string;
        partyName: string;
        convertCount: number;
        sample: {
            originalName: string;
            duration: number | null;
            tracks: {
                audio: ReturnType<typeof trackInfoForResponse>[];
                subtitle: ReturnType<typeof trackInfoForResponse>[];
            };
        };
    }[] = [];

    for (const [zipJobId, entry] of pendingZips.entries()) {
        const sample = entry.candidates[0];
        jobs.push({
            zipJobId,
            partyId: entry.partyId,
            partyName: await partyName(entry.partyId),
            convertCount: entry.candidates.length,
            sample: {
                originalName: sample.originalName,
                duration: sample.probed.duration ?? null,
                tracks: {
                    audio: sample.probed.audio.map(trackInfoForResponse),
                    subtitle: sample.probed.subtitle.map(trackInfoForResponse)
                }
            }
        });
    }

    return res.status(200).json({ success: true, jobs });
};

export const zipUploadController = {
    uploadZipFile,
    finalizeZipConversions,
    cancelPendingZip,
    listPendingZipJobs
};
