import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import multer from 'multer';
import { v4 as uuid } from 'uuid';

import { MediaItem } from '../models/MediaItem.js';
import { Party } from '../models/Party.js';
import { updatePartyItems } from '../database/generalOperations.js';

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

const MEDIA_EXT_RE = /\.(mp4|m4v|mkv|avi|webm|mov|mp3|wav|flac|m4a|aac|ogg)$/i;
const PLAYABLE_EXT_RE = /\.(mp4|m4v|webm|mp3|wav|flac|m4a|aac|ogg)$/i;

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
            return res
                .status(500)
                .json({ success: false, msg: 'unzipError' });
        }

        const files = walkFiles(extractDir).filter((f) =>
            MEDIA_EXT_RE.test(f)
        );

        const created: { id: string; name: string; needsConversion: boolean }[] =
            [];
        const errors: string[] = [];

        for (const src of files) {
            const originalName = path.basename(src);
            const itemId = uuid();
            const safeName = originalName.replace(/[^\w.\-]+/g, '_');
            const destFilename = `${itemId}-${safeName}`;
            const destPath = path.join(
                path.resolve('data/uploads'),
                destFilename
            );

            try {
                fs.renameSync(src, destPath);
            } catch {
                // Fallback to copy across filesystems.
                try {
                    fs.copyFileSync(src, destPath);
                    fs.unlinkSync(src);
                } catch (copyErr) {
                    errors.push(String(copyErr));
                    continue;
                }
            }

            const needsConversion = !PLAYABLE_EXT_RE.test(originalName);

            const newItem: CreationAttributes<MediaItem> = {
                id: itemId,
                type: 'file',
                owner: req.user.id,
                name: originalName,
                url: destFilename,
                settings: needsConversion
                    ? { status: 'needsConversion' }
                    : { status: 'ready' }
            };

            try {
                const dbItem = await MediaItem.create(newItem);
                await updatePartyItems(party.id, dbItem.id);
                created.push({
                    id: dbItem.id,
                    name: originalName,
                    needsConversion
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

        rmDirSafe(extractDir);
        try {
            fs.unlinkSync(zipPath);
        } catch {
            // best effort
        }

        return res.status(200).json({
            success: true,
            count: created.length,
            items: created,
            skipped: errors.length
        });
    });
};

export const zipUploadController = { uploadZipFile };
