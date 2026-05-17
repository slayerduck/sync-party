import fs from 'fs';
import type { ChildProcess } from 'child_process';

const progress = new Map<string, number>();

type ActiveConversion = {
    proc: ChildProcess;
    sourcePath: string;
    outputPath: string;
};

const active = new Map<string, ActiveConversion>();

export const setConversionProgress = (
    itemId: string,
    percent: number
): void => {
    progress.set(itemId, percent);
};

export const getConversionProgress = (itemId: string): number | undefined => {
    return progress.get(itemId);
};

export const clearConversionProgress = (itemId: string): void => {
    progress.delete(itemId);
};

export const registerActiveConversion = (
    itemId: string,
    entry: ActiveConversion
): void => {
    active.set(itemId, entry);
};

export const unregisterActiveConversion = (itemId: string): void => {
    active.delete(itemId);
};

const tryUnlink = (p: string): void => {
    try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
        // best effort
    }
};

/**
 * Kill the running ffmpeg process for this item (if any) and remove
 * both the pending source and the partial output file from disk.
 * Returns true if an active conversion was canceled.
 */
export const cancelActiveConversion = (itemId: string): boolean => {
    const entry = active.get(itemId);
    if (!entry) return false;
    try {
        entry.proc.kill('SIGKILL');
    } catch {
        // best effort
    }
    tryUnlink(entry.sourcePath);
    tryUnlink(entry.outputPath);
    active.delete(itemId);
    progress.delete(itemId);
    return true;
};
