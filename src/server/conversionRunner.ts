import fs from 'fs';
import path from 'path';

import { MediaItem } from './models/MediaItem.js';
import { runConversion, ConversionError } from './ffmpegHelper.js';
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

const logDir = (): string => path.resolve('data/uploads/_log');

const ensureLogDir = (): void => {
    try {
        if (!fs.existsSync(logDir())) {
            fs.mkdirSync(logDir(), { recursive: true });
        }
    } catch {
        // best effort
    }
};

/**
 * Persist a detailed failure record under data/uploads/_log/<itemId>.log
 * so the operator can post-mortem an ffmpeg failure without trawling
 * the server log. Returns the on-disk path of the written file.
 */
export const writeFailureLog = (params: {
    itemId: string;
    label?: string;
    sourcePath: string;
    outputPath: string;
    err: unknown;
}): string | undefined => {
    ensureLogDir();
    const logPath = path.join(logDir(), `${params.itemId}.log`);

    const lines: string[] = [];
    lines.push(`itemId: ${params.itemId}`);
    if (params.label) lines.push(`label:  ${params.label}`);
    lines.push(`source: ${params.sourcePath}`);
    lines.push(`output: ${params.outputPath}`);
    lines.push(`at:     ${new Date().toISOString()}`);
    lines.push('');

    if (params.err instanceof ConversionError) {
        lines.push(`exit:   ${params.err.code}`);
        lines.push('');
        lines.push('command:');
        lines.push(
            `  ${params.err.args.map((a) => JSON.stringify(a)).join(' ')}`
        );
        lines.push('');
        lines.push('stderr:');
        lines.push(params.err.stderr.trim() || '(empty)');
    } else if (params.err instanceof Error) {
        lines.push(`error:  ${params.err.message}`);
        if (params.err.stack) {
            lines.push('');
            lines.push(params.err.stack);
        }
    } else {
        lines.push(`error:  ${String(params.err)}`);
    }

    try {
        fs.writeFileSync(logPath, lines.join('\n') + '\n', 'utf-8');
        return logPath;
    } catch {
        return undefined;
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
    /**
     * Called after the conversion fails, after the failure log has been
     * written and the partial output has been removed. The source file
     * is intentionally kept on disk so the caller can register it for
     * retry; the caller is responsible for cleaning it up later.
     */
    onFailure?: (info: {
        err: unknown;
        errorMessage: string;
        logFile?: string;
    }) => void;
};

/**
 * Enqueue an ffmpeg conversion through the shared pool. Handles spawn
 * registration, progress, DB status updates, file cleanup on success,
 * and on failure writes a detailed log and keeps the source file so the
 * caller can offer a retry.
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
        label,
        onFailure
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

            const logFile = writeFailureLog({
                itemId,
                label,
                sourcePath,
                outputPath,
                err: convErr
            });

            const errorMessage =
                convErr instanceof Error ? convErr.message : String(convErr);

            logger.log(
                'error',
                `Conversion failed${label ? ` for ${label}` : ''} (log: ${
                    logFile ?? 'n/a'
                })`,
                convErr
            );

            try {
                await MediaItem.update(
                    {
                        settings: {
                            status: 'failed',
                            error: errorMessage.slice(0, 500)
                        }
                    },
                    { where: { id: itemId } }
                );
            } catch {
                // already logged
            }

            // Remove the partial output but KEEP the _pending source so
            // the user can retry via the Processing Files page.
            tryUnlink(outputPath);
            clearConversionProgress(itemId);

            if (onFailure) {
                try {
                    onFailure({ err: convErr, errorMessage, logFile });
                } catch (cbErr) {
                    logger.log('error', 'onFailure callback threw', cbErr);
                }
            }
        }
    });
};
