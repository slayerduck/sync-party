import { useEffect, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import Axios from 'axios';

import {
    getUpdatedUserParties,
    getUpdatedUserItems
} from '../../../common/requests';
import { axiosConfig } from '../../../common/helpers';

import type { ReactElement } from 'react';
import type { IMediaItem } from '../../../../../shared/types';

interface Props {
    item: IMediaItem;
    probablyEditedItem: IMediaItem;
    setProbablyEditedItem: (probablyEditedItem: IMediaItem) => void;
    editMode: boolean;
    handleItemClick: (mediaItem: IMediaItem) => void;
    nameEditingAllowed: boolean;
}

const StatusBadge = ({
    status,
    percent
}: {
    status: 'converting' | 'failed' | 'needsConversion';
    percent: number | null;
}): ReactElement => {
    const { t } = useTranslation();
    const map: Record<string, { text: string; classes: string }> = {
        converting: {
            text: t('mediaMenu.statusConverting'),
            classes: 'bg-yellow-700 text-yellow-100'
        },
        failed: {
            text: t('mediaMenu.statusFailed'),
            classes: 'bg-red-700 text-red-100'
        },
        needsConversion: {
            text: t('mediaMenu.statusNeedsConversion'),
            classes: 'bg-gray-700 text-gray-100'
        }
    };
    const m = map[status];
    const label =
        status === 'converting' && typeof percent === 'number'
            ? `${m.text} ${percent}%`
            : m.text;
    return (
        <span className={`ml-2 px-1 rounded text-xs ${m.classes}`}>
            {label}
        </span>
    );
};

const ProgressBar = ({ percent }: { percent: number }): ReactElement => (
    <div className="w-full h-1 mt-1 bg-gray-800 rounded overflow-hidden">
        <div
            className="h-1 bg-purple-500 transition-[width] duration-300"
            style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
        ></div>
    </div>
);

export const ItemListedBody = ({
    item,
    probablyEditedItem,
    setProbablyEditedItem,
    editMode,
    handleItemClick,
    nameEditingAllowed
}: Props): ReactElement => {
    const { t } = useTranslation();
    const dispatch = useDispatch();
    const status = item.settings?.status;
    const isConverting = status === 'converting';

    const [percent, setPercent] = useState<number | null>(null);
    const finishedRef = useRef(false);

    useEffect(() => {
        if (!isConverting) {
            setPercent(null);
            finishedRef.current = false;
            return;
        }

        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const poll = async (): Promise<void> => {
            try {
                const res = await Axios.get(
                    `/api/conversionProgress/${item.id}`,
                    axiosConfig()
                );
                if (cancelled) return;
                if (typeof res.data.percent === 'number') {
                    setPercent(res.data.percent);
                }
                if (
                    res.data.status &&
                    res.data.status !== 'converting' &&
                    !finishedRef.current
                ) {
                    finishedRef.current = true;
                    getUpdatedUserParties(dispatch, t);
                    getUpdatedUserItems(dispatch, t);
                    return;
                }
            } catch {
                // best effort; keep polling
            }
            if (!cancelled) {
                timer = setTimeout(poll, 1500);
            }
        };
        poll();
        return (): void => {
            cancelled = true;
            if (timer) clearTimeout(timer);
        };
    }, [isConverting, item.id, dispatch, t]);

    const showBadge =
        status === 'converting' ||
        status === 'failed' ||
        status === 'needsConversion';
    const playable = !showBadge;

    return (
        <div
            className="flex-col w-full"
            onClick={(): void => {
                if (!editMode && playable) {
                    handleItemClick(item);
                }
            }}
        >
            {!editMode || !nameEditingAllowed ? (
                <span className="breakLongWords">
                    {item.name}
                    {showBadge && (
                        <StatusBadge
                            status={
                                status as
                                    | 'converting'
                                    | 'failed'
                                    | 'needsConversion'
                            }
                            percent={percent}
                        />
                    )}
                </span>
            ) : (
                <input
                    autoFocus
                    className="bg-gray-200 text-gray-800 w-full p-1"
                    value={probablyEditedItem.name}
                    onChange={(event): void => {
                        setProbablyEditedItem({
                            ...probablyEditedItem,
                            name: event.target.value
                        });
                    }}
                ></input>
            )}
            {isConverting && percent !== null && (
                <ProgressBar percent={percent} />
            )}
        </div>
    );
};
