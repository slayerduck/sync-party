import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import Axios from 'axios';

import { useStreamingChannel } from '../../../common/useStreamingChannel';
import { axiosConfig } from '../../../common/helpers';
import { StreamDiagnostics } from '../../streaming/StreamDiagnostics';
import { RemoteVideo } from '../../streaming/RemoteVideo';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faArrowLeft,
    faTowerBroadcast,
    faCircleDot,
    faCopy
} from '@fortawesome/free-solid-svg-icons';

import { GLOBAL_OBS_CHANNEL } from '../../../../../shared/types';

import type { ReactElement } from 'react';
import type { Socket } from 'socket.io-client';
import type { RootAppState } from '../../../../../shared/types';

type Props = {
    socket: Socket | null;
};

type ObsInfo = {
    configured: boolean;
    url: string;
    streamKey: string;
};

export const ScreenObsStream = ({ socket }: Props): ReactElement => {
    const { t } = useTranslation();
    const user = useSelector((state: RootAppState) => state.globalState.user);

    const { state } = useStreamingChannel(
        socket,
        GLOBAL_OBS_CHANNEL,
        user ? user.id : null
    );

    const [redirectHome, setRedirectHome] = useState(false);
    const [info, setInfo] = useState<ObsInfo | null>(null);
    const [copied, setCopied] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async (): Promise<void> => {
            try {
                const res = await Axios.get<ObsInfo>(
                    '/api/obs/info',
                    axiosConfig()
                );
                if (!cancelled) setInfo(res.data);
            } catch {
                // best effort; the page still works as a viewer
            }
        })();
        return (): void => {
            cancelled = true;
        };
    }, []);

    // Nobody streams from the browser here; OBS is the only publisher. So
    // "live" simply means the channel has a streamer.
    const isLive = state.streamerUserId !== null;

    const copy = (label: string, value: string): void => {
        navigator.clipboard?.writeText(value).then(
            () => {
                setCopied(label);
                setTimeout(() => setCopied(null), 1500);
            },
            () => undefined
        );
    };

    if (redirectHome) {
        return <Navigate to={'/'}></Navigate>;
    }

    return (
        <div
            className="min-h-screen w-full text-gray-100"
            style={{
                background:
                    'radial-gradient(1200px 600px at 20% -10%, rgba(94,240,155,0.16), transparent 60%), radial-gradient(900px 500px at 100% 10%, rgba(159,122,234,0.12), transparent 60%), #0a0a0f'
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
                        {isLive && (
                            <FontAwesomeIcon
                                icon={faCircleDot}
                                className="text-red-500 animate-pulse"
                            />
                        )}
                        {t('obs.heading')}
                    </span>
                </div>
            </header>

            <main className="max-w-5xl mx-auto px-4 pt-8 pb-16">
                <StreamDiagnostics state={state} isViewer={isLive} />

                {!socket && (
                    <div className="text-sm text-gray-400">
                        {t('streaming.connecting')}
                    </div>
                )}

                {/* Live: watch the OBS stream */}
                {isLive && (
                    <RemoteVideo
                        remoteStream={state.remoteStream}
                        hasAudio={state.remoteHasAudio}
                    />
                )}

                {/* Idle: nobody streaming — show OBS ingest setup */}
                {socket && !isLive && (
                    <div className="rounded-xl border border-dashed border-white/10 bg-white/5 p-8">
                        <div className="text-center mb-6">
                            <FontAwesomeIcon
                                icon={faTowerBroadcast}
                                size="2x"
                                className="text-gray-500 mb-4"
                            />
                            <p className="text-sm text-gray-400">
                                {t('obs.idleHint')}
                            </p>
                        </div>

                        {info && !info.configured && (
                            <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3 text-sm text-yellow-200">
                                {t('obs.notConfigured')}
                            </div>
                        )}

                        {info && info.configured && (
                            <div className="max-w-xl mx-auto space-y-4">
                                <p className="text-xs text-gray-400">
                                    {t('obs.setupIntro')}
                                </p>
                                <Field
                                    label={t('obs.serverLabel')}
                                    value={info.url}
                                    copiedLabel={copied}
                                    onCopy={copy}
                                />
                                <Field
                                    label={t('obs.keyLabel')}
                                    value={info.streamKey}
                                    copiedLabel={copied}
                                    onCopy={copy}
                                    secret
                                />
                                <p className="text-xs text-gray-500">
                                    {t('obs.setupSteps')}
                                </p>
                            </div>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
};

type FieldProps = {
    label: string;
    value: string;
    secret?: boolean;
    copiedLabel: string | null;
    onCopy: (label: string, value: string) => void;
};

const Field = ({
    label,
    value,
    secret,
    copiedLabel,
    onCopy
}: FieldProps): ReactElement => (
    <div>
        <div className="text-xs text-gray-400 mb-1">{label}</div>
        <div className="flex items-center gap-2">
            <input
                readOnly
                type={secret ? 'password' : 'text'}
                value={value}
                onFocus={(e): void => e.target.select()}
                className="flex-1 rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-sm font-mono text-gray-200"
            />
            <button
                type="button"
                onClick={(): void => onCopy(label, value)}
                className="px-3 py-2 rounded-lg text-sm bg-white/5 hover:bg-white/10 border border-white/10 flex items-center gap-2"
            >
                <FontAwesomeIcon icon={faCopy} />
                {copiedLabel === label ? '✓' : ''}
            </button>
        </div>
    </div>
);
