import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import multer from 'multer';
import { v4 as uuid } from 'uuid';

import { MediaItem } from '../models/MediaItem.js';
import { Party } from '../models/Party.js';
import { updatePartyItems } from '../database/generalOperations.js';
import {
    probeTracks,
    pickDefaultAudio,
    pickDefaultSubtitle,
    shouldBurnInByDefault,
    runConversion
} from '../ffmpegHelper.js';
import {
    setConversionProgress,
    clearConversionProgress
} from '../conversionProgress.js';

import type { Request, Response } from 'express';
import type { Logger } from 'winston';
import type { CreationAttributes } from 'sequelize';

const zipPendingDir = () => path.resolve('data/uploads/_pending');

const ensureDir = (p: string) => {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
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

const rmDirSafe = (dir: string) => {
    try {
        fs.rmSync(dir, { recursive: true, force: true });
    } catch {
        // best effort
    }
};

const uploadZipFile = (req: Request, res: Response, logger: Logger) => {
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
            try {
                fs.unlinkSync(req.file.path);
            } catch {
                // best effort
            }
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
            try {
                fs.unlinkSync(zipPath);
            } catch {
                // best effort
            }
            rmDirSafe(extractDir);
            return res.status(500).json({ success: false, msg: 'unzipError' });
        }

        const files = walkFiles(extractDir).filter((f) => MEDIA_EXT_RE.test(f));

        const created: {
            id: string;
            name: string;
            needsConversion: boolean;
        }[] = [];
        const errors: string[] = [];

        const uploadsDir = path.resolve('data/uploads');
        ensureDir(zipPendingDir());

        for (const src of files) {
            const originalName = path.basename(src);
            const displayName = stripExt(originalName) || originalName;
            const itemId = uuid();
            const safeName = sanitize(originalName);
            const safeBase = sanitize(stripExt(originalName) || originalName);
            const needsConversion = !PLAYABLE_EXT_RE.test(originalName);

            if (needsConversion) {
                // Move into the pending directory; we'll re-encode to mp4 in
                // the uploads directory and remove the source on success.
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

                let probed;
                try {
                    probed = await probeTracks(pendingPath);
                } catch (probeErr) {
                    logger.log('error', 'probe failed for zip item', probeErr);
                    errors.push(String(probeErr));
                    try {
                        fs.unlinkSync(pendingPath);
                    } catch {
                        // best effort
                    }
                    continue;
                }

                const defaultAudio = pickDefaultAudio(probed.audio);
                const defaultSub = pickDefaultSubtitle(probed.subtitle);
                const burn =
                    shouldBurnInByDefault(defaultAudio) && defaultSub !== null;

                if (!defaultAudio) {
                    logger.log(
                        'warn',
                        `Skipping ${originalName}: no audio track`
                    );
                    try {
                        fs.unlinkSync(pendingPath);
                    } catch {
                        // best effort
                    }
                    errors.push(`${originalName}: no audio track`);
                    continue;
                }

                const outputFilename = `${itemId}-${safeBase}.mp4`;
                const outputPath = path.join(uploadsDir, outputFilename);

                const newItem: CreationAttributes<MediaItem> = {
                    id: itemId,
                    type: 'file',
                    owner: req.user.id,
                    name: displayName,
                    url: outputFilename,
                    settings: { status: 'converting' }
                };

                try {
                    const dbItem = await MediaItem.create(newItem);
                    await updatePartyItems(party.id, dbItem.id);
                    created.push({
                        id: dbItem.id,
                        name: displayName,
                        needsConversion: true
                    });
                } catch (dbErr) {
                    logger.log('error', 'Failed to insert zip item', dbErr);
                    errors.push(String(dbErr));
                    try {
                        fs.unlinkSync(pendingPath);
                    } catch {
                        // best effort
                    }
                    continue;
                }

                const subOrdinal = defaultSub
                    ? probed.subtitle.findIndex(
                          (t) => t.index === defaultSub.index
                      )
                    : null;

                setConversionProgress(itemId, 0);

                runConversion({
                    inputPath: pendingPath,
                    outputPath,
                    audioStreamIndex: defaultAudio.index,
                    subtitleStreamIndex: burn
                        ? null
                        : defaultSub
                        ? defaultSub.index
                        : null,
                    subtitleOrdinal: burn ? subOrdinal : null,
                    burnSubtitles: burn,
                    videoInfo: probed.video,
                    audioInfo: defaultAudio,
                    duration: probed.duration,
                    onProgress: (pct) => setConversionProgress(itemId, pct)
                })
                    .then(async () => {
                        try {
                            await MediaItem.update(
                                { settings: { status: 'ready' } },
                                { where: { id: itemId } }
                            );
                        } catch (updErr) {
                            logger.log(
                                'error',
                                'Failed to mark zip conversion ready',
                                updErr
                            );
                        }
                        try {
                            if (fs.existsSync(pendingPath))
                                fs.unlinkSync(pendingPath);
                        } catch {
                            // best effort
                        }
                        setTimeout(
                            () => clearConversionProgress(itemId),
                            5000
                        );
                    })
                    .catch(async (convErr) => {
                        logger.log(
                            'error',
                            `Conversion failed for ${originalName}`,
                            convErr
                        );
                        try {
                            await MediaItem.update(
                                {
                                    settings: {
                                        status: 'failed',
                                        error: String(convErr).slice(0, 500)
                                    }
                                },
                                { where: { id: itemId } }
                            );
                        } catch {
                            // already logged
                        }
                        try {
                            if (fs.existsSync(outputPath))
                                fs.unlinkSync(outputPath);
                        } catch {
                            // best effort
                        }
                        try {
                            if (fs.existsSync(pendingPath))
                                fs.unlinkSync(pendingPath);
                        } catch {
                            // best effort
                        }
                        clearConversionProgress(itemId);
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
                    created.push({
                        id: dbItem.id,
                        name: displayName,
                        needsConversion: false
                    });
                } catch (dbErr) {
                    logger.log('error', 'Failed to insert zip item', dbErr);
                    errors.push(String(dbErr));
                    try {
                        fs.unlinkSync(destPath);
                    } catch {
                        // best effort
                    }
                }
            }
        }

        rmDirSafe(extractDir);
        try {
            fs.unlinkSync(zipPath);
        } catch {
            // best effort
        }

        const converting = created.filter((c) => c.needsConversion).length;

        return res.status(200).json({
            success: true,
            count: created.length,
            converting,
            items: created,
            skipped: errors.length
        });
    });
};

export const zipUploadController = { uploadZipFile };
