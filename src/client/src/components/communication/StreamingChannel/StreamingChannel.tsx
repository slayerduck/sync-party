import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useStreamingChannel } from '../../../common/useStreamingChannel';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faDesktop,
    faStop,
    faCircleDot,
    faExpand,
    faCompress
} from '@fortawesome/free-solid-svg-icons';

import type { ReactElement } from 'react';
import type { Socket } from 'socket.io-client';

interface Props {
    socket: Socket | null;
    partyId: string;
    ourUserId: string;
}

export const StreamingChannel = ({
    socket,
    partyId,
    ourUserId
}: Props): ReactElement | null => {
    const { t } = useTranslation();
    const { state, startSharing, stopSharing } = useStreamingChannel(
        socket,
        partyId,
        ourUserId
    );

    const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
    const localVideoRef = useRef<HTMLVideoElement | null>(null);
    const [expanded, setExpanded] = useState(false);
    const [errorBanner, setErrorBanner] = useState<string | null>(null);

    useEffect(() => {
        if (remoteVideoRef.current && state.remoteStream) {
            if (
                remoteVideoRef.current.srcObject !== state.remoteStream.stream
            ) {
                remoteVideoRef.current.srcObject = state.remoteStream.stream;
            }
        }
    }, [state.remoteStream]);

    useEffect(() => {
        if (localVideoRef.current && state.localStream) {
            if (localVideoRef.current.srcObject !== state.localStream) {
                localVideoRef.current.srcObject = state.localStream;
            }
        }
    }, [state.localStream]);

    const onStart = async (): Promise<void> => {
        try {
            setErrorBanner(null);
            await startSharing();
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            // getDisplayMedia rejects with NotAllowedError when the user
            // dismisses the picker — don't shout about that.
            if (/NotAllowedError|aborted/i.test(msg)) return;
            setErrorBanner(msg);
        }
    };

    const onStop = (): void => {
        stopSharing();
    };

    const isViewer =
        !state.isStreamer &&
        state.streamerUserId !== null &&
        state.streamerUserId !== ourUserId;
    const slotTaken =
        state.streamerUserId !== null && state.streamerUserId !== ourUserId;

    if (!socket) return null;

    return (
        <div
            className={
                'absolute z-30 backgroundShade rounded text-gray-100 text-xs ' +
                (expanded
                    ? 'top-4 left-1/2 -translate-x-1/2 w-[90vw] max-w-5xl p-3'
                    : 'top-2 right-2 p-2 w-72')
            }
        >
            <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                    {(state.isStreamer || isViewer) && (
                        <FontAwesomeIcon
                            icon={faCircleDot}
                            className="text-red-500 animate-pulse"
                        />
                    )}
                    <span className="font-semibold tracking-wide">
                        {t('streaming.heading')}
                    </span>
                </div>
                {(state.isStreamer || isViewer) && (
                    <button
                        type="button"
                        onClick={(): void => setExpanded((c) => !c)}
                        className="p-1 rounded hover:bg-white/10"
                        title={
                            expanded
                                ? t('streaming.shrink')
                                : t('streaming.expand')
                        }
                    >
                        <FontAwesomeIcon
                            icon={expanded ? faCompress : faExpand}
                            size="sm"
                        />
                    </button>
                )}
            </div>

            {errorBanner && (
                <div className="mb-2 text-red-300 break-words">
                    {errorBanner}
                </div>
            )}

            {!state.isStreamer && !isViewer && (
                <button
                    type="button"
                    onClick={onStart}
                    disabled={slotTaken}
                    className={
                        'w-full inline-flex items-center justify-center gap-2 rounded px-2 py-1.5 ' +
                        (slotTaken
                            ? 'bg-white/5 text-gray-500 cursor-not-allowed'
                            : 'bg-purple-600 hover:bg-purple-500')
                    }
                >
                    <FontAwesomeIcon icon={faDesktop} />
                    {slotTaken
                        ? t('streaming.someoneElseSharing')
                        : t('streaming.share')}
                </button>
            )}

            {state.isStreamer && (
                <div>
                    <video
                        ref={localVideoRef}
                        autoPlay
                        muted
                        playsInline
                        className={
                            (expanded
                                ? 'w-full max-h-[70vh]'
                                : 'w-full max-h-40') +
                            ' bg-black rounded mb-2 object-contain'
                        }
                    />
                    <button
                        type="button"
                        onClick={onStop}
                        className="w-full inline-flex items-center justify-center gap-2 rounded px-2 py-1.5 bg-red-600 hover:bg-red-500"
                    >
                        <FontAwesomeIcon icon={faStop} />
                        {t('streaming.stop')}
                    </button>
                </div>
            )}

            {isViewer && (
                <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    controls
                    className={
                        (expanded ? 'w-full max-h-[80vh]' : 'w-full max-h-40') +
                        ' bg-black rounded object-contain'
                    }
                />
            )}
        </div>
    );
};
