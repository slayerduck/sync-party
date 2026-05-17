import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';

export type TrackInfo = {
    index: number;
    codec?: string;
    language: string | undefined;
    title?: string;
    profile?: string;
    bitRate?: number;
    sampleRate?: number;
    channels?: number;
};

export type VideoInfo = {
    codec?: string;
    profile?: string;
    level?: number;
    pixFmt?: string;
    bitRate?: number;
};

export type ProbedTracks = {
    audio: TrackInfo[];
    subtitle: TrackInfo[];
    video?: VideoInfo;
    duration?: number;
};

type FFProbeStream = {
    index: number;
    codec_type: string;
    codec_name?: string;
    profile?: string;
    level?: number;
    pix_fmt?: string;
    bit_rate?: string;
    sample_rate?: string;
    channels?: number;
    tags?: { language?: string; title?: string };
};

type FFProbeOutput = {
    streams?: FFProbeStream[];
    format?: { duration?: string; bit_rate?: string };
};

const toNum = (v: string | undefined): number | undefined => {
    if (v === undefined || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
};

export const probeTracks = (filePath: string): Promise<ProbedTracks> => {
    return new Promise((resolve, reject) => {
        const proc = spawn('ffprobe', [
            '-v',
            'error',
            '-print_format',
            'json',
            '-show_streams',
            '-show_format',
            filePath
        ]);

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (d) => (stdout += d.toString()));
        proc.stderr.on('data', (d) => (stderr += d.toString()));

        proc.on('error', (err) => reject(err));
        proc.on('close', (code) => {
            if (code !== 0) {
                return reject(
                    new Error(`ffprobe exited ${code}: ${stderr.trim()}`)
                );
            }
            try {
                const data: FFProbeOutput = JSON.parse(stdout);
                const streams = data.streams || [];
                const audio: TrackInfo[] = [];
                const subtitle: TrackInfo[] = [];
                let video: VideoInfo | undefined;

                for (const s of streams) {
                    if (s.codec_type === 'audio') {
                        audio.push({
                            index: s.index,
                            codec: s.codec_name,
                            language: s.tags?.language,
                            title: s.tags?.title,
                            profile: s.profile,
                            bitRate: toNum(s.bit_rate),
                            sampleRate: toNum(s.sample_rate),
                            channels: s.channels
                        });
                    } else if (s.codec_type === 'subtitle') {
                        subtitle.push({
                            index: s.index,
                            codec: s.codec_name,
                            language: s.tags?.language,
                            title: s.tags?.title
                        });
                    } else if (s.codec_type === 'video' && !video) {
                        video = {
                            codec: s.codec_name,
                            profile: s.profile,
                            level: s.level,
                            pixFmt: s.pix_fmt,
                            bitRate: toNum(s.bit_rate)
                        };
                    }
                }

                const duration = toNum(data.format?.duration);

                resolve({ audio, subtitle, video, duration });
            } catch (err) {
                reject(err);
            }
        });
    });
};

const isLang = (t: TrackInfo, codes: string[]) =>
    t.language ? codes.includes(t.language.toLowerCase()) : false;

// Prefer 'jpn'/'ja', then 'eng'/'en', then first available.
export const pickDefaultAudio = (audio: TrackInfo[]): TrackInfo | null => {
    if (audio.length === 0) return null;
    return (
        audio.find((t) => isLang(t, ['jpn', 'ja'])) ||
        audio.find((t) => isLang(t, ['eng', 'en'])) ||
        audio[0]
    );
};

// Prefer 'eng'/'en', then first.
export const pickDefaultSubtitle = (
    subtitle: TrackInfo[]
): TrackInfo | null => {
    if (subtitle.length === 0) return null;
    return subtitle.find((t) => isLang(t, ['eng', 'en'])) || subtitle[0];
};

// Burn subs by default only when the chosen audio is NOT English.
export const shouldBurnInByDefault = (audio: TrackInfo | null): boolean => {
    if (!audio || !audio.language) return true;
    return !['eng', 'en'].includes(audio.language.toLowerCase());
};

// Firefox plays h264 only when profile is Baseline/Main/High (not High10
// or other 10-bit profiles), pixel format is yuv420p, and level <= 4.1.
const FIREFOX_SAFE_H264_PROFILES = new Set([
    'Constrained Baseline',
    'Baseline',
    'Main',
    'High'
]);

export const isVideoBrowserSafe = (v: VideoInfo | undefined): boolean => {
    if (!v) return false;
    if (v.codec !== 'h264') return false;
    if (!v.profile || !FIREFOX_SAFE_H264_PROFILES.has(v.profile)) return false;
    if (v.pixFmt !== 'yuv420p') return false;
    if (v.level === undefined) return false;
    return v.level <= 41;
};

// Firefox needs AAC-LC. HE-AAC and HE-AACv2 are not reliably supported.
export const isAudioBrowserSafe = (a: TrackInfo | undefined): boolean => {
    if (!a) return false;
    return a.codec === 'aac' && a.profile === 'LC';
};

const clampBitRate = (bps: number | undefined): string => {
    if (!bps || !Number.isFinite(bps)) return '192k';
    // Round to nearest kbit, keep between 96 and 320 kbit/s.
    const kbit = Math.max(96, Math.min(320, Math.round(bps / 1000)));
    return `${kbit}k`;
};

export type ConversionOptions = {
    inputPath: string;
    outputPath: string;
    // Absolute ffmpeg stream index of the chosen audio (e.g. 1 in "0:1").
    audioStreamIndex: number;
    // Absolute index for embedding via -map. Null means no subtitle output.
    subtitleStreamIndex: number | null;
    // Subtitle-only ordinal (0 = first subtitle stream) for the subtitles filter.
    // Required only when burnSubtitles is true.
    subtitleOrdinal: number | null;
    burnSubtitles: boolean;
    // Source-stream metadata used to decide whether to copy or transcode.
    videoInfo?: VideoInfo;
    audioInfo?: TrackInfo;
    // Source duration in seconds, used to compute percent progress.
    duration?: number;
    // Called with 0..100 as ffmpeg makes progress.
    onProgress?: (percent: number) => void;
    // Invoked right after the ffmpeg child process is spawned; lets the
    // caller register the process so it can be killed externally.
    onSpawn?: (proc: ChildProcess) => void;
};

export const runConversion = (opts: ConversionOptions): Promise<void> => {
    return new Promise((resolve, reject) => {
        // Re-encode video whenever burning subs in, or whenever the source
        // isn't already a browser-safe h264/yuv420p baseline/main/high<=L4.1.
        const transcodeVideo =
            opts.burnSubtitles || !isVideoBrowserSafe(opts.videoInfo);

        // Re-encode audio whenever it isn't already AAC-LC.
        const transcodeAudio = !isAudioBrowserSafe(opts.audioInfo);

        const args: string[] = [
            '-y',
            '-nostats',
            '-progress',
            'pipe:1',
            '-i',
            opts.inputPath
        ];

        if (opts.burnSubtitles && opts.subtitleOrdinal !== null) {
            const escaped = opts.inputPath.replace(/'/g, "'\\''");
            args.push(
                '-vf',
                `subtitles='${escaped}':si=${opts.subtitleOrdinal}`
            );
        }

        if (transcodeVideo) {
            args.push(
                '-c:v',
                'libx264',
                '-preset',
                'slow',
                '-crf',
                '21',
                '-profile:v',
                'high',
                '-level',
                '4.1',
                '-pix_fmt',
                'yuv420p'
            );
        } else {
            args.push('-c:v', 'copy');
        }

        args.push('-map', '0:v:0', '-map', `0:${opts.audioStreamIndex}`);

        if (transcodeAudio) {
            args.push(
                '-c:a',
                'aac',
                '-profile:a',
                'aac_low',
                '-b:a',
                clampBitRate(opts.audioInfo?.bitRate),
                '-ac',
                String(Math.min(2, opts.audioInfo?.channels ?? 2))
            );
        } else {
            args.push('-c:a', 'copy');
        }

        if (!opts.burnSubtitles && opts.subtitleStreamIndex !== null) {
            args.push(
                '-map',
                `0:${opts.subtitleStreamIndex}`,
                '-c:s',
                'mov_text'
            );
        }

        args.push('-movflags', '+faststart', opts.outputPath);

        // Run ffmpeg at a low CPU priority so a long encode doesn't starve
        // the rest of the server.
        const proc = spawn('nice', ['-n', '19', 'ffmpeg', ...args]);
        opts.onSpawn?.(proc);

        let stderr = '';
        let stdoutBuf = '';
        let lastPct = -1;

        const handleProgressLine = (line: string): void => {
            const m = line.match(/^out_time_us=(\d+)/);
            if (!m) return;
            const usec = Number(m[1]);
            if (!opts.duration || !Number.isFinite(usec)) return;
            const pct = Math.max(
                0,
                Math.min(99, Math.round(usec / 1_000_000 / opts.duration * 100))
            );
            if (pct !== lastPct) {
                lastPct = pct;
                opts.onProgress?.(pct);
            }
        };

        proc.stdout.on('data', (d) => {
            stdoutBuf += d.toString();
            let nl: number;
            while ((nl = stdoutBuf.indexOf('\n')) !== -1) {
                handleProgressLine(stdoutBuf.slice(0, nl).trim());
                stdoutBuf = stdoutBuf.slice(nl + 1);
            }
        });

        proc.stderr.on('data', (d) => {
            stderr += d.toString();
        });

        proc.on('error', (err) => reject(err));
        proc.on('close', (code) => {
            if (code === 0) {
                opts.onProgress?.(100);
                resolve();
            } else {
                reject(
                    new Error(
                        `ffmpeg exited ${code}: ${stderr.trim().slice(-2000)}`
                    )
                );
            }
        });
    });
};
