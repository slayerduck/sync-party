import { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { setGlobalState } from '../../../actions/globalActions';
import Axios from 'axios';
import { axiosConfig } from '../../../common/helpers';
import {
    getUpdatedUserParties,
    getUpdatedUserItems
} from '../../../common/requests';
import { useTranslation } from 'react-i18next';

import { AddMediaTabBar } from '../AddMediaTabBar/AddMediaTabBar';
import { AddMediaTabUser } from '../AddMediaTabUser/AddMediaTabUser';
import { AddMediaTabWeb } from '../AddMediaTabWeb/AddMediaTabWeb';
import { AddMediaUploadProgress } from '../AddMediaUploadProgress/AddMediaUploadProgress';
import { Button } from '../../input/Button/Button';
import { ConvertTrackPicker } from '../ConvertTrackPicker/ConvertTrackPicker';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faThumbsUp } from '@fortawesome/free-regular-svg-icons';
import { faPlus } from '@fortawesome/free-solid-svg-icons';
import { AddMediaTabFile } from '../AddMediaTabFile/AddMediaTabFile';
import { AddMediaTabZip } from '../AddMediaTabZip/AddMediaTabZip';
import { AddMediaTabConvert } from '../AddMediaTabConvert/AddMediaTabConvert';

import type { Socket } from 'socket.io-client';
import type {
    AddMediaTab,
    ClientParty,
    IMediaItem,
    NewMediaItem,
    RootAppState,
    ZipPendingConvertInfo
} from '../../../../../shared/types';

type Props = {
    isActive: boolean;
    partyItemsSet: Set<string>;
    setAddMediaIsActive: (isActive: boolean) => void;
    socket: Socket | null;
    setPlayerFocused: (focused: boolean) => void;
    handleItemEditSave: (mediaItem: IMediaItem) => Promise<void>;
};

export const AddMedia = ({
    isActive,
    partyItemsSet,
    setAddMediaIsActive,
    socket,
    setPlayerFocused,
    handleItemEditSave
}: Props): JSX.Element => {
    const { t } = useTranslation();

    const user = useSelector((state: RootAppState) => state.globalState.user);
    const party = useSelector((state: RootAppState) => state.globalState.party);
    const userItems = useSelector(
        (state: RootAppState) => state.globalState.userItems
    );

    const mediaItemDefault: NewMediaItem = {
        name: '',
        type: 'file',
        owner: user ? user.id : null,
        url: ''
    };

    const [activeTab, setActiveTab] = useState<AddMediaTab>('file');
    const [file, setFile] = useState<File | null>(null);
    const [mediaItem, setMediaItem] = useState(mediaItemDefault);
    const [uploadStartTime, setUploadStartTime] = useState(0);
    const [isUploading, setIsUploading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [addedSuccessfully, setAddedSuccessfully] = useState(false);
    const [lastCreatedItem, setLastCreatedItem] = useState<NewMediaItem>();
    const [uploadError, setUploadError] = useState(false);
    const [fetchingLinkMetadata, setFetchingLinkMetadata] = useState(false);
    const [linkMetadata, setLinkMetadata] = useState<{
        videoTitle: string;
        channelTitle: string;
    } | null>(null);
    const [zipPendingConvert, setZipPendingConvert] =
        useState<ZipPendingConvertInfo | null>(null);
    const [finalizingZip, setFinalizingZip] = useState(false);

    const dispatch = useDispatch();

    // Preselect user tab if there are items to add
    useEffect(() => {
        if (userItems && party)
            if (
                userItems.filter(
                    (userItem: IMediaItem) => !partyItemsSet.has(userItem.id)
                ).length
            ) {
                setActiveTab('user');
            }
    }, [userItems, party, partyItemsSet]);

    const addUserItem = async (item: IMediaItem): Promise<void> => {
        if (party) {
            try {
                const response = await Axios.post(
                    '/api/partyItems',
                    { mediaItem: item, partyId: party.id },
                    axiosConfig()
                );

                if (response.data.success === true) {
                    updatePartyAndUserParties();
                } else {
                    dispatch(
                        setGlobalState({
                            errorMessage: t(
                                `apiResponseMessages.${response.data.msg}`
                            )
                        })
                    );
                }
            } catch (error) {
                dispatch(
                    setGlobalState({
                        errorMessage: t(`errors.addToPartyError`)
                    })
                );
            }
        }
    };

    const addWebItem = async (event: React.MouseEvent): Promise<void> => {
        event.preventDefault();

        if (party) {
            try {
                const response = await Axios.post(
                    '/api/mediaItem',
                    { mediaItem: mediaItem, partyId: party.id },
                    axiosConfig()
                );

                if (response.data.success === true) {
                    updatePartyAndUserParties();
                    getUpdatedUserItems(dispatch, t);
                    resetUploadForm();
                    setIsUploading(false);
                    setLastCreatedItem(mediaItem);
                    setAddedSuccessfully(true);
                    hideFinishInAFewSecs();
                    toggleCollapseAddMediaMenu();
                } else {
                    dispatch(
                        setGlobalState({
                            errorMessage: t(
                                `apiResponseMessages.${response.data.msg}`
                            )
                        })
                    );
                }
            } catch (error) {
                dispatch(
                    setGlobalState({
                        errorMessage: t(`errors.addItemError`)
                    })
                );
            }
        }
    };

    const addZipItem = async (event: React.MouseEvent): Promise<void> => {
        event.preventDefault();

        if (party && file) {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('partyId', party.id);
            setIsUploading(true);
            setAddedSuccessfully(false);
            setUploadStartTime(Date.now());
            try {
                const response = await Axios.post('/api/file/zip', formData, {
                    headers: {
                        'Content-Type': 'multipart/form-data'
                    },
                    onUploadProgress: (progressEvent) => {
                        const percentCompleted =
                            progressEvent.total !== undefined
                                ? Math.round(
                                      (progressEvent.loaded * 100) /
                                          progressEvent.total
                                  )
                                : 0;
                        setProgress(percentCompleted);
                    },
                    withCredentials: true
                });

                if (response.data.success === true) {
                    updatePartyAndUserParties();
                    getUpdatedUserItems(dispatch, t);
                    resetUploadForm();
                    setIsUploading(false);

                    const readyCount: number = response.data.count || 0;
                    const pending: ZipPendingConvertInfo | null =
                        response.data.pendingZip || null;

                    if (pending && pending.convertCount > 0) {
                        // Keep the menu open so the user can pick tracks
                        // for the convertable files before we queue them.
                        setZipPendingConvert(pending);
                        if (readyCount > 0) {
                            setLastCreatedItem({
                                ...mediaItem,
                                name: t('mediaMenu.zipAddedCount', {
                                    count: readyCount
                                })
                            });
                            setAddedSuccessfully(true);
                            hideFinishInAFewSecs();
                        }
                    } else {
                        setLastCreatedItem({
                            ...mediaItem,
                            name: t('mediaMenu.zipAddedCount', {
                                count: readyCount
                            })
                        });
                        setAddedSuccessfully(true);
                        hideFinishInAFewSecs();
                        toggleCollapseAddMediaMenu();
                    }
                } else {
                    dispatch(
                        setGlobalState({
                            errorMessage: t('mediaMenu.uploadError')
                        })
                    );
                }
            } catch (error) {
                dispatch(
                    setGlobalState({
                        errorMessage: t(`errors.uploadError`)
                    })
                );

                resetUploadForm();
                setIsUploading(false);
                setUploadError(true);
            }
        }
    };

    const finalizeZip = async (choice: {
        audioIndex: number;
        subtitleIndex: number | null;
        burnSubtitles: boolean;
    }): Promise<void> => {
        if (!zipPendingConvert || finalizingZip) return;
        setFinalizingZip(true);
        try {
            const response = await Axios.post(
                `/api/file/zip/${zipPendingConvert.zipJobId}/finalize`,
                choice,
                axiosConfig()
            );
            if (response.data.success === true) {
                const queuedCount = (response.data.queued || []).length;
                await updatePartyAndUserParties();
                getUpdatedUserItems(dispatch, t);
                setLastCreatedItem({
                    ...mediaItem,
                    name: t('mediaMenu.zipQueuedConverting', {
                        count: queuedCount
                    })
                });
                setZipPendingConvert(null);
                setAddedSuccessfully(true);
                hideFinishInAFewSecs();
                toggleCollapseAddMediaMenu();
            } else {
                dispatch(
                    setGlobalState({
                        errorMessage: t('mediaMenu.conversionStartError')
                    })
                );
            }
        } catch {
            dispatch(
                setGlobalState({
                    errorMessage: t('mediaMenu.conversionStartError')
                })
            );
        } finally {
            setFinalizingZip(false);
        }
    };

    const cancelZipPending = async (): Promise<void> => {
        if (!zipPendingConvert) return;
        try {
            await Axios.delete(
                `/api/file/zip/${zipPendingConvert.zipJobId}`,
                axiosConfig()
            );
        } catch {
            // best effort
        }
        setZipPendingConvert(null);
    };

    const onConvertItemCreated = async (): Promise<void> => {
        await updatePartyAndUserParties();
        getUpdatedUserItems(dispatch, t);
        toggleCollapseAddMediaMenu();
    };

    const addFileItem = async (event: React.MouseEvent): Promise<void> => {
        event.preventDefault();

        if (party && file && mediaItem.owner) {
            const formData = new FormData();
            formData.append('owner', mediaItem.owner);
            formData.append('name', mediaItem.name);
            formData.append('file', file);
            formData.append('partyId', party.id);
            setIsUploading(true);
            setAddedSuccessfully(false);
            setUploadStartTime(Date.now());
            try {
                const response = await Axios.post('/api/file', formData, {
                    headers: {
                        'Content-Type': 'multipart/form-data'
                    },
                    onUploadProgress: (progressEvent) => {
                        const percentCompleted =
                            progressEvent.total !== undefined
                                ? Math.round(
                                      (progressEvent.loaded * 100) /
                                          progressEvent.total
                                  )
                                : 0;
                        setProgress(percentCompleted);
                    },
                    withCredentials: true
                });

                if (response.data.success === true) {
                    updatePartyAndUserParties();
                    getUpdatedUserItems(dispatch, t);
                    resetUploadForm();
                    setLastCreatedItem(mediaItem);
                    setIsUploading(false);
                    setAddedSuccessfully(true);
                    hideFinishInAFewSecs();
                    toggleCollapseAddMediaMenu();
                } else {
                    dispatch(
                        setGlobalState({
                            errorMessage: t(
                                `apiResponseMessages.${response.data.msg}`
                            )
                        })
                    );
                }
            } catch (error) {
                dispatch(
                    setGlobalState({
                        errorMessage: t(`errors.uploadError`)
                    })
                );

                resetUploadForm();
                setIsUploading(false);
                setUploadError(true);
            }
        }
    };

    const updatePartyAndUserParties = async (): Promise<void> => {
        if (socket && party && userItems) {
            // Update userParties
            const updatedUserParties = await getUpdatedUserParties(dispatch, t);

            const updatedParty = updatedUserParties.find(
                (userParty: ClientParty) => userParty.id === party.id
            );

            // Preselect file tab if there are no items left to add
            if (
                updatedParty &&
                !userItems.filter(
                    (userItem: IMediaItem) =>
                        !updatedParty.items.find(
                            (item: IMediaItem) => item.id === userItem.id
                        )
                ).length
            ) {
                setActiveTab('file');
            }

            // Update current party
            dispatch(
                setGlobalState({
                    party: updatedParty
                })
            );

            // Ask other users to update their userParties
            socket.emit('partyUpdate', { partyId: party.id });
        }
    };

    const handleLinkInput = async (
        event: React.ChangeEvent<HTMLInputElement>
    ): Promise<void> => {
        let url = event.target.value;

        // YT: Remove list-related URL params
        if (
            url.indexOf('https://www.youtube.com') === 0 &&
            url.indexOf('&list=') > -1
        ) {
            url = url.slice(0, url.indexOf('&list='));
        }

        const webMediaItem: NewMediaItem = {
            ...mediaItem,
            url: url,
            type: 'web'
        };

        setMediaItem(webMediaItem);

        if (url.indexOf('https://www.youtube.com') === 0) {
            setFetchingLinkMetadata(true);

            try {
                const response = await Axios.post(
                    '/api/linkMetadata',
                    { url: url },
                    { ...axiosConfig(), timeout: 3000 }
                );

                setLinkMetadata({
                    videoTitle: response.data.videoTitle,
                    channelTitle: response.data.channelTitle
                });

                setMediaItem({
                    ...webMediaItem,
                    name: response.data.videoTitle
                });

                setFetchingLinkMetadata(false);
            } catch (error) {
                setMediaItem({ ...webMediaItem, name: '' });
                setFetchingLinkMetadata(false);
            }
        }
    };

    const toggleCollapseAddMediaMenu = (): void => {
        if (isActive) {
            setActiveTab('file');
        }
        setAddMediaIsActive(!isActive);
        setUploadError(false);
        resetUploadForm();
    };

    const changeTab = (tab: AddMediaTab): void => {
        setActiveTab(tab);
        setFile(null);
        setMediaItem(mediaItemDefault);
        setUploadError(false);
    };

    const resetUploadForm = (): void => {
        setFile(null);
        setMediaItem(mediaItemDefault);
    };

    const hideFinishInAFewSecs = (): void => {
        setTimeout(() => {
            setAddedSuccessfully(false);
        }, 5000);
    };

    return (
        <div
            className={'mt-2' + (!isActive ? '' : ' flex flex-col flex-shrink')}
        >
            {isActive && (
                <>
                    {zipPendingConvert ? (
                        <div>
                            <p className="mb-2 text-gray-300 text-sm">
                                {t('mediaMenu.zipPickTracksHint', {
                                    count: zipPendingConvert.convertCount,
                                    name: zipPendingConvert.sample.originalName
                                })}
                            </p>
                            <ConvertTrackPicker
                                tracks={zipPendingConvert.sample.tracks}
                                submitLabel={t('mediaMenu.startConversion')}
                                submittingLabel={t(
                                    'mediaMenu.startingConversion'
                                )}
                                busy={finalizingZip}
                                onSubmit={(c): void => {
                                    finalizeZip(c);
                                }}
                                onCancel={(): void => {
                                    cancelZipPending();
                                }}
                                setPlayerFocused={(focused: boolean): void =>
                                    setPlayerFocused(focused)
                                }
                            />
                        </div>
                    ) : (
                        <>
                            <AddMediaTabBar
                                activeTab={activeTab}
                                changeTab={changeTab}
                                isUploading={isUploading}
                                toggleCollapseAddMediaMenu={
                                    toggleCollapseAddMediaMenu
                                }
                            ></AddMediaTabBar>
                            <div className="flex flex-col">
                                {!isUploading &&
                                !uploadError &&
                                userItems &&
                                party ? (
                                    <>
                                        {activeTab === 'user' && (
                                            <AddMediaTabUser
                                                partyItemsSet={partyItemsSet}
                                                addUserItem={addUserItem}
                                                setPlayerFocused={(
                                                    focused: boolean
                                                ): void =>
                                                    setPlayerFocused(focused)
                                                }
                                                handleItemEditSave={
                                                    handleItemEditSave
                                                }
                                            ></AddMediaTabUser>
                                        )}
                                        {activeTab === 'web' && (
                                            <AddMediaTabWeb
                                                mediaItem={mediaItem}
                                                setMediaItem={(
                                                    mediaItem: NewMediaItem
                                                ): void =>
                                                    setMediaItem(mediaItem)
                                                }
                                                addWebItem={addWebItem}
                                                handleLinkInput={
                                                    handleLinkInput
                                                }
                                                setPlayerFocused={(
                                                    focused: boolean
                                                ): void =>
                                                    setPlayerFocused(focused)
                                                }
                                                linkMetadata={linkMetadata}
                                                fetchingLinkMetadata={
                                                    fetchingLinkMetadata
                                                }
                                            ></AddMediaTabWeb>
                                        )}
                                        {activeTab === 'file' && (
                                            <AddMediaTabFile
                                                file={file}
                                                setFile={(file: File): void =>
                                                    setFile(file)
                                                }
                                                mediaItem={mediaItem}
                                                setMediaItem={(
                                                    mediaItem: NewMediaItem
                                                ): void =>
                                                    setMediaItem(mediaItem)
                                                }
                                                addFileItem={addFileItem}
                                                resetUploadForm={
                                                    resetUploadForm
                                                }
                                                setPlayerFocused={(
                                                    focused: boolean
                                                ): void =>
                                                    setPlayerFocused(focused)
                                                }
                                            ></AddMediaTabFile>
                                        )}
                                        {activeTab === 'zip' && (
                                            <AddMediaTabZip
                                                file={file}
                                                setFile={(
                                                    f: File | null
                                                ): void => setFile(f)}
                                                addZipItem={addZipItem}
                                                resetUploadForm={
                                                    resetUploadForm
                                                }
                                            ></AddMediaTabZip>
                                        )}
                                        {activeTab === 'convert' && (
                                            <AddMediaTabConvert
                                                party={party}
                                                onItemCreated={
                                                    onConvertItemCreated
                                                }
                                                setPlayerFocused={(
                                                    focused: boolean
                                                ): void =>
                                                    setPlayerFocused(focused)
                                                }
                                            ></AddMediaTabConvert>
                                        )}
                                    </>
                                ) : !uploadError ? (
                                    <AddMediaUploadProgress
                                        progress={progress}
                                        uploadStartTime={uploadStartTime}
                                    ></AddMediaUploadProgress>
                                ) : (
                                    <div className="my-3">
                                        {t('mediaMenu.uploadError')}
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </>
            )}

            {!isActive && (
                <>
                    <Button
                        padding="p-1"
                        title={t('mediaMenu.addMediaTitle')}
                        text={
                            <>
                                <FontAwesomeIcon
                                    icon={faPlus}
                                ></FontAwesomeIcon>
                                <span>{' ' + t('mediaMenu.addMedia')}</span>
                            </>
                        }
                        onClick={toggleCollapseAddMediaMenu}
                    ></Button>
                    {addedSuccessfully && lastCreatedItem && (
                        <div className="my-3 breakLongWords">
                            <FontAwesomeIcon
                                className="text-purple-400"
                                icon={faThumbsUp}
                            ></FontAwesomeIcon>{' '}
                            {lastCreatedItem.type === 'file'
                                ? t('mediaMenu.uploadFinished')
                                : t('mediaMenu.addingFinished')}
                            {lastCreatedItem.name}
                        </div>
                    )}
                </>
            )}
        </div>
    );
};
