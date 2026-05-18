import fs from 'fs';

import type { ProbedTracks } from './ffmpegHelper.js';

export type FailedConversion = {
    itemId: string;
    partyId: string;
    originalName: string;
    displayName: string;
    sourcePath: string;
    outputPath: string;
    probed: ProbedTracks;
    errorMessage: string;
    logFile?: string;
    failedAt: number;
};

const failed = new Map<string, FailedConversion>();

export const registerFailedConversion = (entry: FailedConversion): void => {
    failed.set(entry.itemId, entry);
};

export const getFailedConversion = (
    itemId: string
): FailedConversion | undefined => failed.get(itemId);

export const listFailedConversions = (): FailedConversion[] =>
    Array.from(failed.values());

export const removeFailedConversion = (itemId: string): void => {
    failed.delete(itemId);
};

const tryUnlink = (p: string): void => {
    try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
        // best effort
    }
};

/** Drop the entry and remove the kept-around _pending source file. */
export const dropFailedConversion = (itemId: string): void => {
    const entry = failed.get(itemId);
    if (entry) {
        tryUnlink(entry.sourcePath);
        failed.delete(itemId);
    }
};
