import { useState, useEffect, useCallback } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import Axios from 'axios';

import { axiosConfig } from '../../../common/helpers';
import { getUpdatedUserParties } from '../../../common/requests';
import { setGlobalState } from '../../../actions/globalActions';
import { ConvertTrackPicker } from '../../ui/ConvertTrackPicker/ConvertTrackPicker';
import { InputText } from '../../input/InputText/InputText';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faArrowLeft,
    faSpinner,
    faFilm,
    faCircleCheck
} from '@fortawesome/free-solid-svg-icons';

import type { ReactElement } from 'react';
import type {
    ClientParty,
    ConvertUploadResponse
} from '../../../../../shared/types';

const CONVERT_EXT_RE =
    /\.(mp4|m4v|mkv|avi|mov|ts|m2ts|wmv|flv|ogv|3gp|vob|webm)$/i;

export const ScreenConvertUpload = (): ReactElement => {
    const { t } = useTranslation();
    const dispatch = useDispatch();

    const [redirectHome, setRedirectHome] = useState(false);
    const [parties, setParties] = useState<ClientParty[]>([]);
    const [partyId, setPartyId] = useState<string>('');
    const [file, setFile] = useState<File | null>(null);
    const [probing, setProbing] = useState(false);
    const [progress, setProgress] = useState(0);
    const [probed, setProbed] = useState<ConvertUploadResponse | null>(null);
    const [name, setName] = useState('');
    const [finalizing, setFinalizing] = useState(false);
    const [doneMessage, setDoneMessage] = useState<string | null>(null);

    const loadParties = useCallback(async (): Promise<void> => {
        try {
            const ps = await getUpdatedUserParties(dispatch, t);
            setParties(ps);
            if (ps.length > 0) {
                setPartyId((cur) => cur || ps[0].id);
            }
        } catch {
            // error surfaced by getUpdatedUserParties
        }
    }, [dispatch, t]);

    useEffect(() => {
        loadParties();
    }, [loadParties]);

    const resetFile = (): void => {
        setFile(null);
        setProbed(null);
        setName('');
        setProgress(0);
    };

    const uploadAndProbe = async (picked: File): Promise<void> => {
        const formData = new FormData();
        formData.append('file', picked);

        setProbing(true);
        setProgress(0);
        setDoneMessage(null);

        try {
            const response = await Axios.post<ConvertUploadResponse>(
                '/api/file/convert',
                formData,
                {
                    headers: { 'Content-Type': 'multipart/form-data' },
                    withCredentials: true,
                    onUploadProgress: (progressEvent) => {
                        const pct =
                            progressEvent.total !== undefined
                                ? Math.round(
                                      (progressEvent.loaded * 100) /
                                          progressEvent.total
                                  )
                                : 0;
                        setProgress(pct);
                    }
                }
            );

            if (response.data.success) {
                setProbed(response.data);
                setName(response.data.originalName.replace(/\.[^.]+$/, ''));
            } else {
                dispatch(
                    setGlobalState({ errorMessage: t('mediaMenu.probeError') })
                );
                resetFile();
            }
        } catch {
            dispatch(setGlobalState({ errorMessage: t('errors.uploadError') }));
            resetFile();
        } finally {
            setProbing(false);
        }
    };

    const cancelPending = async (): Promise<void> => {
        if (probed) {
            try {
                await Axios.delete(
                    `/api/file/convert/${probed.pendingId}`,
                    axiosConfig()
                );
            } catch {
                // best effort
            }
        }
        resetFile();
    };

    const finalize = async (choice: {
        audioIndex: number;
        subtitleIndex: number | null;
        burnSubtitles: boolean;
    }): Promise<void> => {
        if (!probed || !partyId || name.trim().length === 0 || finalizing) {
            return;
        }
        setFinalizing(true);
        try {
            const response = await Axios.post(
                `/api/file/convert/${probed.pendingId}/finalize`,
                {
                    name: name.trim(),
                    partyId,
                    audioIndex: choice.audioIndex,
                    subtitleIndex: choice.subtitleIndex,
                    burnSubtitles: choice.burnSubtitles
                },
                axiosConfig()
            );
            if (response.data.success) {
                const targetParty = parties.find((p) => p.id === partyId);
                setDoneMessage(
                    t('convertUpload.queued', {
                        name: name.trim(),
                        party: targetParty ? targetParty.name : ''
                    })
                );
                resetFile();
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
            setFinalizing(false);
        }
    };

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
                <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
                    <button
                        type="button"
                        onClick={(): void => setRedirectHome(true)}
                        title={t('common.back')}
                        className="px-2 py-1 rounded hover:bg-white/10 text-sm flex items-center gap-2"
                    >
                        <FontAwesomeIcon icon={faArrowLeft} size="sm" />
                        {t('common.back')}
                    </button>
                    <span className="font-semibold tracking-wide ml-2">
                        {t('convertUpload.heading')}
                    </span>
                </div>
            </header>

            <main className="max-w-3xl mx-auto px-4 pt-8 pb-16">
                <p className="text-sm text-gray-400 mb-6">
                    {t('convertUpload.description')}
                </p>

                {doneMessage && (
                    <div className="mb-6 rounded-xl border border-green-500/30 bg-green-500/5 p-4 flex items-start gap-3">
                        <FontAwesomeIcon
                            icon={faCircleCheck}
                            className="text-green-400 mt-0.5"
                        />
                        <div className="text-sm text-green-200">
                            {doneMessage}
                        </div>
                    </div>
                )}

                <div className="rounded-xl border border-white/10 bg-white/5 p-4 sm:p-5">
                    <label className="block text-xs uppercase tracking-wider text-gray-400 mb-2">
                        {t('convertUpload.targetRoom')}
                    </label>
                    {parties.length === 0 ? (
                        <p className="text-sm text-gray-500 mb-4">
                            {t('convertUpload.noRooms')}
                        </p>
                    ) : (
                        <select
                            value={partyId}
                            onChange={(e): void => setPartyId(e.target.value)}
                            disabled={!!probed}
                            className="w-full mb-4 bg-gray-200 text-gray-900 rounded py-2 px-2 disabled:opacity-60"
                        >
                            {parties.map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.name}
                                </option>
                            ))}
                        </select>
                    )}

                    {!probed && !probing && (
                        <div className="relative h-32">
                            <div className="w-full absolute top-0 left-0 border-dashed border-4 border-white/20 rounded-lg flex">
                                <div className="m-auto text-center px-4">
                                    <FontAwesomeIcon
                                        icon={faFilm}
                                        className="text-gray-500 mb-2"
                                        size="lg"
                                    />
                                    <p className="text-sm text-gray-300">
                                        {t('convertUpload.dropHint')}
                                    </p>
                                </div>
                            </div>
                            <input
                                className="w-full h-32 opacity-0 cursor-pointer z-10 relative"
                                type="file"
                                disabled={parties.length === 0}
                                onChange={(e): void => {
                                    if (!e.target.files) return;
                                    const picked = e.target.files[0];
                                    if (!picked) return;
                                    if (CONVERT_EXT_RE.test(picked.name)) {
                                        setFile(picked);
                                        uploadAndProbe(picked);
                                    } else {
                                        dispatch(
                                            setGlobalState({
                                                errorMessage: t(
                                                    'mediaMenu.invalidConvertFile'
                                                )
                                            })
                                        );
                                        e.target.value = '';
                                    }
                                }}
                            ></input>
                        </div>
                    )}

                    {probing && (
                        <div>
                            <div className="flex items-center gap-2 text-sm text-gray-300 mb-2">
                                <FontAwesomeIcon icon={faSpinner} spin />
                                {progress < 100
                                    ? t('mediaMenu.uploadingLabel')
                                    : t('mediaMenu.probingLabel')}
                            </div>
                            <div className="w-full h-2 bg-gray-800 rounded overflow-hidden">
                                <div
                                    className="h-2 bg-purple-500 transition-[width] duration-200"
                                    style={{
                                        width: `${Math.max(
                                            0,
                                            Math.min(100, progress)
                                        )}%`
                                    }}
                                ></div>
                            </div>
                        </div>
                    )}

                    {probed && (
                        <div>
                            <p className="mb-2 text-gray-300 text-sm truncate">
                                {file ? file.name : probed.originalName}
                            </p>
                            <InputText
                                value={name}
                                containerClassName="mb-3"
                                placeholder={t('mediaMenu.addNameDescription')}
                                onChange={(
                                    e: React.ChangeEvent<HTMLInputElement>
                                ): void => setName(e.target.value)}
                            ></InputText>
                            <ConvertTrackPicker
                                tracks={probed.tracks}
                                defaults={probed.defaults}
                                submitLabel={t('mediaMenu.startConversion')}
                                submittingLabel={t(
                                    'mediaMenu.startingConversion'
                                )}
                                busy={finalizing}
                                onSubmit={(c): void => {
                                    finalize(c);
                                }}
                                onCancel={(): void => {
                                    cancelPending();
                                }}
                            />
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
};
