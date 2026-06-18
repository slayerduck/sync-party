import { useTranslation } from 'react-i18next';

import type { ReactElement } from 'react';
import type { StreamingState } from '../../common/useStreamingChannel';

type Props = {
    state: StreamingState;
    isViewer: boolean;
};

/**
 * Live connection diagnostics for a streaming channel (screen share or OBS).
 * Read this to see where a stream breaks: socket/role/streamer/TURN, the
 * send/recv ICE-DTLS state, audio status, capture surface, and any
 * publish/subscribe errors.
 */
export const StreamDiagnostics = ({ state, isViewer }: Props): ReactElement => {
    const { t } = useTranslation();

    return (
        <details className="mb-4 rounded-lg border border-white/10 bg-white/5 text-xs">
            <summary className="cursor-pointer select-none px-3 py-2 text-gray-300">
                {t('screenShare.diagnostics')}
            </summary>
            <div className="px-3 pb-3 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 font-mono text-gray-400">
                <div>
                    socket:{' '}
                    <span
                        className={
                            state.socketConnected
                                ? 'text-green-400'
                                : 'text-red-400'
                        }
                    >
                        {state.socketConnected ? 'connected' : 'disconnected'}
                    </span>
                </div>
                <div>
                    role:{' '}
                    <span className="text-gray-200">
                        {state.isStreamer
                            ? 'streamer'
                            : isViewer
                            ? 'viewer'
                            : 'idle'}
                    </span>
                </div>
                <div>
                    streamer:{' '}
                    <span className="text-gray-200">
                        {state.streamerUserId
                            ? state.streamerUserId.slice(0, 8)
                            : 'none'}
                    </span>
                </div>
                <div>
                    TURN:{' '}
                    <span
                        className={
                            state.turnConfigured
                                ? 'text-green-400'
                                : 'text-yellow-400'
                        }
                    >
                        {state.turnConfigured ? 'configured' : 'STUN-only'}
                    </span>
                </div>
                <div>
                    send:{' '}
                    <span
                        className={
                            state.sendState === 'connected'
                                ? 'text-green-400'
                                : state.sendState === 'failed'
                                ? 'text-red-400'
                                : 'text-gray-200'
                        }
                    >
                        {state.sendState}
                    </span>
                </div>
                <div>
                    recv:{' '}
                    <span
                        className={
                            state.recvState === 'connected'
                                ? 'text-green-400'
                                : state.recvState === 'failed'
                                ? 'text-red-400'
                                : 'text-gray-200'
                        }
                    >
                        {state.recvState}
                    </span>
                </div>
                <div>
                    audio:{' '}
                    <span className="text-gray-200">
                        {state.isStreamer
                            ? state.audioCaptured
                                ? 'captured'
                                : 'none captured'
                            : isViewer
                            ? state.remoteHasAudio
                                ? 'track present'
                                : 'no track'
                            : '—'}
                    </span>
                </div>
                {state.isStreamer && (
                    <div>
                        surface:{' '}
                        <span className="text-gray-200">
                            {state.captureSurface ?? 'unknown'}
                        </span>
                    </div>
                )}
                {state.produceError && (
                    <div className="col-span-2 sm:col-span-3 break-words">
                        publish error:{' '}
                        <span className="text-red-400">
                            {state.produceError}
                        </span>
                    </div>
                )}
                {state.consumeError && (
                    <div className="col-span-2 sm:col-span-3 break-words">
                        subscribe error:{' '}
                        <span className="text-red-400">
                            {state.consumeError}
                        </span>
                    </div>
                )}
            </div>
        </details>
    );
};
