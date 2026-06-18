import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faVolumeHigh, faVolumeXmark } from '@fortawesome/free-solid-svg-icons';

import type { ReactElement } from 'react';
import type { ViewerStream } from '../../common/useStreamingChannel';

type Props = {
    remoteStream: ViewerStream | null;
    hasAudio: boolean;
};

/**
 * Plays an incoming WebRTC stream for a viewer through a SINGLE <video>
 * element holding both the audio and video tracks. Rendering both tracks in
 * one element lets the browser keep them in lip-sync via RTCP timestamps —
 * splitting audio into a separate <audio> sink (as we used to) discards that
 * sync and causes A/V drift.
 *
 * Autoplay-with-sound is often blocked, so we attempt sound first and fall
 * back to muted playback with an "enable sound" button (a click gesture
 * unblocks audio). Volume/mute act directly on the element. Shared by the
 * screen-share and OBS pages.
 */
export const RemoteVideo = ({
    remoteStream,
    hasAudio
}: Props): ReactElement => {
    const { t } = useTranslation();
    const [audioBlocked, setAudioBlocked] = useState(false);
    const [volume, setVolume] = useState(1);
    const [muted, setMuted] = useState(false);
    const videoRef = useRef<HTMLVideoElement | null>(null);

    useEffect(() => {
        const el = videoRef.current;
        if (!el || !remoteStream) return;
        // One element, both tracks -> the browser keeps audio/video in sync.
        el.srcObject = remoteStream.stream;
        el.volume = volume;
        el.muted = muted;
        // Try to play with sound; if the browser blocks autoplay-with-audio,
        // fall back to muted playback and surface an "enable sound" button.
        el.play()
            .then(() => setAudioBlocked(false))
            .catch(() => {
                el.muted = true;
                setMuted(true);
                setAudioBlocked(true);
                el.play().catch(() => undefined);
            });
        // volume/muted are applied by their own effect; only re-run on a new
        // stream.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [remoteStream]);

    useEffect(() => {
        const el = videoRef.current;
        if (!el) return;
        el.volume = volume;
        el.muted = muted;
    }, [volume, muted]);

    const enableSound = (): void => {
        const el = videoRef.current;
        if (!el) return;
        setMuted(false);
        el.muted = false;
        el.play()
            .then(() => setAudioBlocked(false))
            .catch(() => setAudioBlocked(true));
    };

    return (
        <div>
            {audioBlocked && hasAudio && (
                <button
                    type="button"
                    onClick={enableSound}
                    className="mb-3 inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm bg-purple-600 hover:bg-purple-500"
                >
                    {t('screenShare.enableSound')}
                </button>
            )}
            <div className="rounded-xl border border-white/10 bg-black/40 overflow-hidden">
                <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    controls
                    className="w-full max-h-[75vh] bg-black object-contain"
                />
            </div>
            {hasAudio && (
                <div className="mt-3 flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                    <button
                        type="button"
                        onClick={(): void => setMuted((m) => !m)}
                        title={
                            muted
                                ? t('screenShare.unmute')
                                : t('screenShare.mute')
                        }
                        className="px-2 py-1 rounded hover:bg-white/10 text-gray-200"
                    >
                        <FontAwesomeIcon
                            icon={
                                muted || volume === 0
                                    ? faVolumeXmark
                                    : faVolumeHigh
                            }
                        />
                    </button>
                    <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={muted ? 0 : volume}
                        onChange={(e): void => {
                            const v = Number(e.target.value);
                            setVolume(v);
                            setMuted(v === 0);
                        }}
                        aria-label={t('screenShare.volume')}
                        className="w-40 accent-purple-500"
                    />
                </div>
            )}
        </div>
    );
};
