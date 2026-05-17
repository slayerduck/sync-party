import { useTranslation } from 'react-i18next';
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
    status
}: {
    status: 'converting' | 'failed' | 'needsConversion';
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
    return (
        <span className={`ml-2 px-1 rounded text-xs ${m.classes}`}>
            {m.text}
        </span>
    );
};

export const ItemListedBody = ({
    item,
    probablyEditedItem,
    setProbablyEditedItem,
    editMode,
    handleItemClick,
    nameEditingAllowed
}: Props): ReactElement => {
    const status = item.settings?.status;
    const showBadge =
        status === 'converting' ||
        status === 'failed' ||
        status === 'needsConversion';
    const playable =
        status !== 'converting' &&
        status !== 'failed' &&
        status !== 'needsConversion';

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
        </div>
    );
};
