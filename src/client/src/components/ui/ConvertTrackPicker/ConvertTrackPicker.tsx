import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../input/Button/Button';

import type { ReactElement } from 'react';
import type { ConvertTrackInfo } from '../../../../../shared/types';

interface Props {
    tracks: { audio: ConvertTrackInfo[]; subtitle: ConvertTrackInfo[] };
    defaults?: {
        audioIndex: number | null;
        subtitleIndex: number | null;
        burnSubtitles: boolean;
    };
    submitLabel: string;
    submittingLabel: string;
    busy: boolean;
    onSubmit: (choice: {
        audioIndex: number;
        subtitleIndex: number | null;
        burnSubtitles: boolean;
    }) => void;
    onCancel: () => void;
    setPlayerFocused?: (focused: boolean) => void;
}

const describeTrack = (t: ConvertTrackInfo, fallbackLabel: string): string => {
    const parts: string[] = [];
    parts.push(`#${t.index}`);
    if (t.language) parts.push(t.language);
    if (t.title) parts.push(t.title);
    if (t.codec) parts.push(`(${t.codec})`);
    return parts.length > 1 ? parts.join(' · ') : fallbackLabel;
};

const pickDefaults = (
    tracks: Props['tracks']
): {
    audioIndex: number | null;
    subtitleIndex: number | null;
    burnSubtitles: boolean;
} => {
    const audio =
        tracks.audio.find(
            (t) =>
                t.language && ['jpn', 'ja'].includes(t.language.toLowerCase())
        ) ||
        tracks.audio.find(
            (t) =>
                t.language && ['eng', 'en'].includes(t.language.toLowerCase())
        ) ||
        tracks.audio[0];
    const sub =
        tracks.subtitle.find(
            (t) =>
                t.language && ['eng', 'en'].includes(t.language.toLowerCase())
        ) || tracks.subtitle[0];
    const burn =
        !audio?.language ||
        !['eng', 'en'].includes(audio.language.toLowerCase());
    return {
        audioIndex: audio ? audio.index : null,
        subtitleIndex: sub ? sub.index : null,
        burnSubtitles: !!sub && burn
    };
};

export const ConvertTrackPicker = ({
    tracks,
    defaults,
    submitLabel,
    submittingLabel,
    busy,
    onSubmit,
    onCancel,
    setPlayerFocused
}: Props): ReactElement => {
    const { t } = useTranslation();
    const initial = defaults || pickDefaults(tracks);
    const [audioIndex, setAudioIndex] = useState<number | null>(
        initial.audioIndex
    );
    const [subtitleIndex, setSubtitleIndex] = useState<number | null>(
        initial.subtitleIndex
    );
    const [burnSubtitles, setBurnSubtitles] = useState<boolean>(
        initial.burnSubtitles
    );

    useEffect(() => {
        if (subtitleIndex === null && burnSubtitles) {
            setBurnSubtitles(false);
        }
    }, [subtitleIndex, burnSubtitles]);

    const onFocusEvt = (): void => setPlayerFocused?.(false);
    const onBlurEvt = (): void => setPlayerFocused?.(true);

    return (
        <div>
            <label className="block mb-1 text-sm text-gray-200">
                {t('mediaMenu.convertAudioTrack')}
            </label>
            <select
                value={audioIndex ?? ''}
                onChange={(e): void =>
                    setAudioIndex(
                        e.target.value === '' ? null : Number(e.target.value)
                    )
                }
                className="w-full mb-3 bg-gray-200 text-gray-900 rounded py-1 px-2"
                onFocus={onFocusEvt}
                onBlur={onBlurEvt}
            >
                {tracks.audio.length === 0 && (
                    <option value="">{t('mediaMenu.convertNoAudio')}</option>
                )}
                {tracks.audio.map((track) => (
                    <option key={track.index} value={track.index}>
                        {describeTrack(track, t('mediaMenu.convertAudioTrack'))}
                    </option>
                ))}
            </select>

            <label className="block mb-1 text-sm text-gray-200">
                {t('mediaMenu.convertSubtitleTrack')}
            </label>
            <select
                value={subtitleIndex ?? 'none'}
                onChange={(e): void => {
                    const v = e.target.value;
                    setSubtitleIndex(v === 'none' ? null : Number(v));
                }}
                className="w-full mb-3 bg-gray-200 text-gray-900 rounded py-1 px-2"
                onFocus={onFocusEvt}
                onBlur={onBlurEvt}
            >
                <option value="none">{t('mediaMenu.convertNoSubtitle')}</option>
                {tracks.subtitle.map((track) => (
                    <option key={track.index} value={track.index}>
                        {describeTrack(
                            track,
                            t('mediaMenu.convertSubtitleTrack')
                        )}
                    </option>
                ))}
            </select>

            <label className="flex items-center mb-3 text-sm text-gray-200">
                <input
                    type="checkbox"
                    className="mr-2"
                    checked={burnSubtitles}
                    disabled={subtitleIndex === null}
                    onChange={(e): void => setBurnSubtitles(e.target.checked)}
                />
                {t('mediaMenu.convertBurnSubtitles')}
            </label>

            <Button
                onClick={(): void => onCancel()}
                className="mt-1 mb-2 mr-2"
                color="text-gray-200 hover:text-gray-400"
                text={t('mediaMenu.clearLabel')}
            ></Button>
            <Button
                type="button"
                onClick={(e): void => {
                    e.preventDefault();
                    if (audioIndex === null || busy) return;
                    onSubmit({
                        audioIndex,
                        subtitleIndex,
                        burnSubtitles: burnSubtitles && subtitleIndex !== null
                    });
                }}
                className="mt-1"
                text={busy ? submittingLabel : submitLabel}
            ></Button>
        </div>
    );
};
