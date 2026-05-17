import fs from 'fs';

import { MediaItem } from './models/MediaItem.js';
import { runConversion } from './ffmpegHelper.js';
import { conversionPool } from './conversionPool.js';
import {
    setConversionProgress,
    clearConversionProgress,
    registerActiveConversion,
    unregisterActiveConversion
} from './conversionProgress.js';

import type { Logger } from 'winston';
import type { TrackInfo, VideoInfo } from './ffmpegHelper.js';

const tryUnlink = (p: string): void => {
    try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
        // best effort
    }
};

export type QueueConversionParams = {
    itemId: string;
    sourcePath: string;
    outputPath: string;
    audioStreamIndex: number;
    subtitleStreamIndex: number | null;
    subtitleOrdinal: number | null;
    burnSubtitles: boolean;
    videoInfo?: VideoInfo;
    audioInfo?: TrackInfo;
    duration?: number;
    logger: Logger;
    label?: string;
};

/**
 * Enqueue an ffmpeg conversion through the shared pool. Handles spawn
 * registration, progress, DB status updates, and source/output cleanup
 * on both success and failure paths.
 */
export const queueConversion = (params: QueueConversionParams): void => {
    const {
        itemId,
        sourcePath,
        outputPath,
        audioStreamIndex,
        subtitleStreamIndex,
        subtitleOrdinal,
        burnSubtitles,
        videoInfo,
        audioInfo,
        duration,
        logger,
        label
    } = params;

    setConversionProgress(itemId, 0);

    conversionPool.submit(async () => {
        try {
            await runConversion({
                inputPath: sourcePath,
                outputPath,
                audioStreamIndex,
                subtitleStreamIndex,
                subtitleOrdinal,
                burnSubtitles,
                videoInfo,
                audioInfo,
                duration,
                onProgress: (pct) => setConversionProgress(itemId, pct),
                onSpawn: (proc) =>
                    registerActiveConversion(itemId, {
                        proc,
                        sourcePath,
                        outputPath
                    })
            });
            unregisterActiveConversion(itemId);
            try {
                await MediaItem.update(
                    { settings: { status: 'ready' } },
                    { where: { id: itemId } }
                );
            } catch (updErr) {
                logger.log('error', 'Failed to mark conversion ready', updErr);
            }
            tryUnlink(sourcePath);
            setTimeout(() => clearConversionProgress(itemId), 5000);
        } catch (convErr) {
            unregisterActiveConversion(itemId);
            logger.log(
                'error',
                `Conversion failed${label ? ` for ${label}` : ''}`,
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
            tryUnlink(outputPath);
            tryUnlink(sourcePath);
            clearConversionProgress(itemId);
        }
    });
};
