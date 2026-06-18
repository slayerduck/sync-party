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
 * Plays an incoming WebRTC stream for a viewer. The picture goes to a muted,
 * video-only <video>; sound goes through a dedicated <audio> sink (the
 * reliable way to render remote audio). Provides volume/mute, an "enable
 * sound" gesture fallback, and keeps the audio in lock-step with the video's
 * pause/play. Shared by the screen-share and OBS pages.
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
    const audioRef = useRef<HTMLAudioElement | null>(null);

    useEffect(() => {
        if (!remoteStream) return;
        const stream = remoteStream.stream;

        const videoEl = videoRef.current;
        if (videoEl) {
            videoEl.srcObject = new MediaStream(stream.getVideoTracks());
            videoEl.muted = true;
            videoEl.play().catch(() => undefined);
        }

        const audioEl = audioRef.current;
        if (audioEl) {
            const audioTracks = stream.getAudioTracks();
            if (audioTracks.length > 0) {
                audioEl.srcObject = new MediaStream(audioTracks);
                audioEl.volume = volume;
                audioEl.muted = muted;
                audioEl
                    .play()
                    .then(() => setAudioBlocked(false))
                    .catch(() => setAudioBlocked(true));
            }
        }
        // volume/muted are applied by their own effect; only re-run on a new
        // stream.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [remoteStream]);

    useEffect(() => {
        const el = audioRef.current;
        if (!el) return;
        el.volume = volume;
        el.muted = muted;
    }, [volume, muted]);

    const enableSound = (): void => {
        const el = audioRef.current;
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
                    muted
                    controls
                    // Keep the dedicated audio sink in lock-step with the
                    // picture so the native pause/play also stops/starts sound.
                    onPlay={(): void => {
                        audioRef.current?.play().catch(() => undefined);
                    }}
                    onPause={(): void => audioRef.current?.pause()}
                    className="w-full max-h-[75vh] bg-black object-contain"
                />
            </div>
            {/* Dedicated sink for remote audio (see attach effect) */}
            <audio ref={audioRef} autoPlay className="hidden" />
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
