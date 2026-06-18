import { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';

import { useStreamingChannel } from '../../../common/useStreamingChannel';
import { StreamDiagnostics } from '../../streaming/StreamDiagnostics';
import { RemoteVideo } from '../../streaming/RemoteVideo';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faArrowLeft,
    faDesktop,
    faStop,
    faCircleDot
} from '@fortawesome/free-solid-svg-icons';

import { GLOBAL_STREAM_CHANNEL } from '../../../../../shared/types';

import type { ReactElement } from 'react';
import type { Socket } from 'socket.io-client';
import type { RootAppState } from '../../../../../shared/types';

type Props = {
    socket: Socket | null;
};

export const ScreenScreenShare = ({ socket }: Props): ReactElement => {
    const { t } = useTranslation();
    const user = useSelector((state: RootAppState) => state.globalState.user);

    const { state, startSharing, stopSharing } = useStreamingChannel(
        socket,
        GLOBAL_STREAM_CHANNEL,
        user ? user.id : null
    );

    const [redirectHome, setRedirectHome] = useState(false);
    const [errorBanner, setErrorBanner] = useState<string | null>(null);
    const [shareMic, setShareMic] = useState(false);
    const localVideoRef = useRef<HTMLVideoElement | null>(null);

    useEffect(() => {
        const el = localVideoRef.current;
        if (!el || !state.localStream) return;
        // The streamer's own preview shows the picture only. Give it a
        // video-only stream and mute it imperatively so the streamer never
        // hears their own captured/mic audio played back (React's declarative
        // `muted` prop is unreliable, hence setting el.muted directly).
        el.srcObject = new MediaStream(state.localStream.getVideoTracks());
        el.muted = true;
        el.play().catch(() => undefined);
    }, [state.localStream]);

    const onStart = async (): Promise<void> => {
        try {
            setErrorBanner(null);
            await startSharing({ includeMic: shareMic });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (/NotAllowedError|aborted/i.test(msg)) return;
            setErrorBanner(msg);
        }
    };

    // Viewer = someone is streaming and it isn't THIS connection. We rely on
    // our own role (state.isStreamer), not a userId comparison, so a second
    // device of the same account is correctly treated as a viewer.
    const isViewer = !state.isStreamer && state.streamerUserId !== null;
    const slotTaken = !state.isStreamer && state.streamerUserId !== null;

    if (redirectHome) {
        return <Navigate to={'/'}></Navigate>;
    }

    return (
        <div
            className="min-h-screen w-full text-gray-100"
            style={{
                background:
                    'radial-gradient(1200px 600px at 20% -10%, rgba(159,122,234,0.18), transparent 60%), radial-gradient(900px 500px at 100% 10%, rgba(94,240,155,0.10), transparent 60%), #0a0a0f'
            }}
        >
            <header className="sticky top-0 z-30 backdrop-blur bg-black/40 border-b border-white/10">
                <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
                    <button
                        type="button"
                        onClick={(): void => setRedirectHome(true)}
                        title={t('common.back')}
                        className="px-2 py-1 rounded hover:bg-white/10 text-sm flex items-center gap-2"
                    >
                        <FontAwesomeIcon icon={faArrowLeft} size="sm" />
                        {t('common.back')}
                    </button>
                    <span className="font-semibold tracking-wide ml-2 flex items-center gap-2">
                        {(state.isStreamer || isViewer) && (
                            <FontAwesomeIcon
                                icon={faCircleDot}
                                className="text-red-500 animate-pulse"
                            />
                        )}
                        {t('streaming.heading')}
                    </span>
                </div>
            </header>

            <main className="max-w-5xl mx-auto px-4 pt-8 pb-16">
                {errorBanner && (
                    <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300 break-words">
                        {errorBanner}
                    </div>
                )}

                <StreamDiagnostics state={state} isViewer={isViewer} />

                {!socket && (
                    <div className="text-sm text-gray-400">
                        {t('streaming.connecting')}
                    </div>
                )}

                {/* Viewer: someone else is streaming */}
                {isViewer && (
                    <RemoteVideo
                        remoteStream={state.remoteStream}
                        hasAudio={state.remoteHasAudio}
                    />
                )}

                {/* Streamer: our own preview + stop */}
                {state.isStreamer && (
                    <div>
                        {!state.audioCaptured && (
                            <div className="mb-4 rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3 text-sm text-yellow-200">
                                {state.captureSurface === 'window'
                                    ? t('screenShare.noAudioWindow')
                                    : state.captureSurface === 'monitor'
                                    ? t('screenShare.noAudioScreen')
                                    : t('screenShare.noAudio')}
                            </div>
                        )}
                        <div className="rounded-xl border border-white/10 bg-black/40 overflow-hidden mb-4">
                            <video
                                ref={localVideoRef}
                                autoPlay
                                muted
                                playsInline
                                className="w-full max-h-[75vh] bg-black object-contain"
                            />
                        </div>
                        <button
                            type="button"
                            onClick={(): void => {
                                stopSharing();
                            }}
                            className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm bg-red-600 hover:bg-red-500"
                        >
                            <FontAwesomeIcon icon={faStop} />
                            {t('streaming.stop')}
                        </button>
                    </div>
                )}

                {/* Idle: nobody streaming, offer to share */}
                {socket && !state.isStreamer && !isViewer && (
                    <div className="rounded-xl border border-dashed border-white/10 bg-white/5 p-10 text-center">
                        <FontAwesomeIcon
                            icon={faDesktop}
                            size="2x"
                            className="text-gray-500 mb-4"
                        />
                        <p className="text-sm text-gray-400 mb-4">
                            {slotTaken
                                ? t('streaming.someoneElseSharing')
                                : t('screenShare.idleHint')}
                        </p>
                        {!slotTaken && (
                            <>
                                <p className="text-xs text-gray-500 mb-4 max-w-md mx-auto">
                                    {t('screenShare.audioTip')}
                                </p>
                                <label className="flex items-center justify-center gap-2 mb-6 text-sm text-gray-300 cursor-pointer select-none">
                                    <input
                                        type="checkbox"
                                        checked={shareMic}
                                        onChange={(e): void =>
                                            setShareMic(e.target.checked)
                                        }
                                        className="accent-purple-500"
                                    />
                                    {t('screenShare.shareMic')}
                                </label>
                            </>
                        )}
                        <button
                            type="button"
                            onClick={onStart}
                            disabled={slotTaken}
                            className={
                                'inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium ' +
                                (slotTaken
                                    ? 'bg-white/5 text-gray-500 cursor-not-allowed'
                                    : 'bg-purple-600 hover:bg-purple-500')
                            }
                        >
                            <FontAwesomeIcon icon={faDesktop} />
                            {t('streaming.share')}
                        </button>
                    </div>
                )}
            </main>
        </div>
    );
};
