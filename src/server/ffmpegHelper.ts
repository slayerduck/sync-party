import { spawn } from 'child_process';

export type TrackInfo = {
    index: number;
    codec?: string;
    language: string | undefined;
    title?: string;
};

export type ProbedTracks = {
    audio: TrackInfo[];
    subtitle: TrackInfo[];
    duration?: number;
};

type FFProbeStream = {
    index: number;
    codec_type: string;
    codec_name?: string;
    tags?: { language?: string; title?: string };
};

type FFProbeOutput = {
    streams?: FFProbeStream[];
    format?: { duration?: string };
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

                for (const s of streams) {
                    const entry: TrackInfo = {
                        index: s.index,
                        codec: s.codec_name,
                        language: s.tags?.language,
                        title: s.tags?.title
                    };
                    if (s.codec_type === 'audio') audio.push(entry);
                    else if (s.codec_type === 'subtitle') subtitle.push(entry);
                }

                const duration = data.format?.duration
                    ? Number(data.format.duration)
                    : undefined;

                resolve({ audio, subtitle, duration });
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
    return (
        subtitle.find((t) => isLang(t, ['eng', 'en'])) || subtitle[0]
    );
};

// Burn subs by default only when the chosen audio is NOT English.
export const shouldBurnInByDefault = (audio: TrackInfo | null): boolean => {
    if (!audio || !audio.language) return true;
    return !['eng', 'en'].includes(audio.language.toLowerCase());
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
    onProgress?: (line: string) => void;
};

export const runConversion = (opts: ConversionOptions): Promise<void> => {
    return new Promise((resolve, reject) => {
        const args: string[] = ['-y', '-i', opts.inputPath];

        if (opts.burnSubtitles && opts.subtitleOrdinal !== null) {
            const escaped = opts.inputPath.replace(/'/g, "'\\''");
            args.push(
                '-vf',
                `subtitles='${escaped}':si=${opts.subtitleOrdinal}`,
                '-c:v',
                'libx264',
                '-preset',
                'veryfast',
                '-crf',
                '20'
            );
        } else {
            args.push('-c:v', 'copy');
        }

        args.push(
            '-map',
            '0:v:0',
            '-map',
            `0:${opts.audioStreamIndex}`,
            '-c:a',
            'aac',
            '-b:a',
            '192k'
        );

        if (!opts.burnSubtitles && opts.subtitleStreamIndex !== null) {
            args.push(
                '-map',
                `0:${opts.subtitleStreamIndex}`,
                '-c:s',
                'mov_text'
            );
        }

        args.push('-movflags', '+faststart', opts.outputPath);

        const proc = spawn('ffmpeg', args);

        let stderr = '';
        proc.stderr.on('data', (d) => {
            const line = d.toString();
            stderr += line;
            if (opts.onProgress) opts.onProgress(line);
        });

        proc.on('error', (err) => reject(err));
        proc.on('close', (code) => {
            if (code === 0) resolve();
            else
                reject(
                    new Error(
                        `ffmpeg exited ${code}: ${stderr.trim().slice(-2000)}`
                    )
                );
        });
    });
};
