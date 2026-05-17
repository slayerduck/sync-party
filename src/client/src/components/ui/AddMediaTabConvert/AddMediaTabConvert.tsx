import { useState } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import Axios from 'axios';

import { setGlobalState } from '../../../actions/globalActions';
import { axiosConfig } from '../../../common/helpers';
import { Button } from '../../input/Button/Button';
import { InputText } from '../../input/InputText/InputText';

import type { ReactElement } from 'react';
import type {
    ClientParty,
    ConvertTrackInfo,
    ConvertUploadResponse
} from '../../../../../shared/types';

interface Props {
    party: ClientParty;
    onItemCreated: () => Promise<void>;
    setPlayerFocused: (focused: boolean) => void;
}

const CONVERT_EXT_RE = /\.(mkv|avi|mov|ts|m2ts|wmv|flv|ogv|3gp|vob)$/i;

const describeTrack = (t: ConvertTrackInfo, fallbackLabel: string): string => {
    const parts: string[] = [];
    parts.push(`#${t.index}`);
    if (t.language) parts.push(t.language);
    if (t.title) parts.push(t.title);
    if (t.codec) parts.push(`(${t.codec})`);
    return parts.length > 1 ? parts.join(' · ') : fallbackLabel;
};

export const AddMediaTabConvert = ({
    party,
    onItemCreated,
    setPlayerFocused
}: Props): ReactElement => {
    const { t } = useTranslation();
    const dispatch = useDispatch();

    const [file, setFile] = useState<File | null>(null);
    const [isProbing, setIsProbing] = useState(false);
    const [progress, setProgress] = useState(0);
    const [probed, setProbed] = useState<ConvertUploadResponse | null>(null);
    const [name, setName] = useState('');
    const [audioIndex, setAudioIndex] = useState<number | null>(null);
    const [subtitleIndex, setSubtitleIndex] = useState<number | null>(null);
    const [burnSubtitles, setBurnSubtitles] = useState(false);
    const [isFinalizing, setIsFinalizing] = useState(false);

    const reset = (): void => {
        setFile(null);
        setProbed(null);
        setName('');
        setAudioIndex(null);
        setSubtitleIndex(null);
        setBurnSubtitles(false);
        setIsProbing(false);
        setIsFinalizing(false);
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
        reset();
    };

    const uploadAndProbe = async (event: React.MouseEvent): Promise<void> => {
        event.preventDefault();
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file);

        setIsProbing(true);
        setProgress(0);

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
                setAudioIndex(response.data.defaults.audioIndex);
                setSubtitleIndex(response.data.defaults.subtitleIndex);
                setBurnSubtitles(response.data.defaults.burnSubtitles);
            } else {
                dispatch(
                    setGlobalState({
                        errorMessage: t('mediaMenu.probeError')
                    })
                );
            }
        } catch {
            dispatch(setGlobalState({ errorMessage: t('errors.uploadError') }));
        } finally {
            setIsProbing(false);
        }
    };

    const finalize = async (event: React.MouseEvent): Promise<void> => {
        event.preventDefault();
        if (!probed || audioIndex === null || name.length === 0) return;

        setIsFinalizing(true);
        try {
            const response = await Axios.post(
                `/api/file/convert/${probed.pendingId}/finalize`,
                {
                    name,
                    partyId: party.id,
                    audioIndex,
                    subtitleIndex,
                    burnSubtitles: burnSubtitles && subtitleIndex !== null
                },
                axiosConfig()
            );

            if (response.data.success) {
                await onItemCreated();
                reset();
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
            setIsFinalizing(false);
        }
    };

    if (probed) {
        return (
            <form>
                <p className="mb-2 text-gray-300 text-sm truncate">
                    {probed.originalName}
                </p>

                <InputText
                    value={name}
                    containerClassName="mb-3"
                    placeholder={t('mediaMenu.addNameDescription')}
                    onFocus={(): void => setPlayerFocused(false)}
                    onBlur={(): void => setPlayerFocused(true)}
                    onChange={(
                        event: React.ChangeEvent<HTMLInputElement>
                    ): void => setName(event.target.value)}
                ></InputText>

                <label className="block mb-1 text-sm text-gray-200">
                    {t('mediaMenu.convertAudioTrack')}
                </label>
                <select
                    value={audioIndex ?? ''}
                    onChange={(e): void =>
                        setAudioIndex(
                            e.target.value === ''
                                ? null
                                : Number(e.target.value)
                        )
                    }
                    className="w-full mb-3 bg-gray-200 text-gray-900 rounded py-1 px-2"
                    onFocus={(): void => setPlayerFocused(false)}
                    onBlur={(): void => setPlayerFocused(true)}
                >
                    {probed.tracks.audio.length === 0 && (
                        <option value="">
                            {t('mediaMenu.convertNoAudio')}
                        </option>
                    )}
                    {probed.tracks.audio.map((track) => (
                        <option key={track.index} value={track.index}>
                            {describeTrack(
                                track,
                                t('mediaMenu.convertAudioTrack')
                            )}
                        </option>
                    ))}
                </select>

                <label className="block mb-1 text-sm text-gray-200">
                    {t('mediaMenu.convertSubtitleTrack')}
                </label>
                <select
                    value={subtitleIndex ?? 'none'}
                    onChange={(e): void => {
                        const v = e.target.value;
                        setSubtitleIndex(v === 'none' ? null : Number(v));
                    }}
                    className="w-full mb-3 bg-gray-200 text-gray-900 rounded py-1 px-2"
                    onFocus={(): void => setPlayerFocused(false)}
                    onBlur={(): void => setPlayerFocused(true)}
                >
                    <option value="none">
                        {t('mediaMenu.convertNoSubtitle')}
                    </option>
                    {probed.tracks.subtitle.map((track) => (
                        <option key={track.index} value={track.index}>
                            {describeTrack(
                                track,
                                t('mediaMenu.convertSubtitleTrack')
                            )}
                        </option>
                    ))}
                </select>

                <label className="flex items-center mb-3 text-sm text-gray-200">
                    <input
                        type="checkbox"
                        className="mr-2"
                        checked={burnSubtitles}
                        disabled={subtitleIndex === null}
                        onChange={(e): void =>
                            setBurnSubtitles(e.target.checked)
                        }
                    />
                    {t('mediaMenu.convertBurnSubtitles')}
                </label>

                <Button
                    onClick={(): void => {
                        cancelPending();
                    }}
                    className="mt-1 mb-2 mr-2"
                    color="text-gray-200 hover:text-gray-400"
                    text={t('mediaMenu.clearLabel')}
                ></Button>
                <Button
                    type="submit"
                    onClick={(event: React.MouseEvent): Promise<void> =>
                        finalize(event)
                    }
                    className="mt-1"
                    disabled={
                        isFinalizing || audioIndex === null || name.length === 0
                    }
                    text={
                        isFinalizing
                            ? t('mediaMenu.startingConversion')
                            : t('mediaMenu.startConversion')
                    }
                ></Button>
            </form>
        );
    }

    return (
        <form>
            {!file && (
                <div className="relative h-32">
                    <div className="w-full absolute top-0 left-0 border-dashed border-4 flex dropzone">
                        <div className="p-auto m-auto text-center">
                            <p>{t('mediaMenu.addConvertDragDrop')}</p>
                            <p className="mt-6">
                                {t('mediaMenu.addConvertUploadDialog')}
                            </p>
                        </div>
                    </div>
                    <input
                        className="w-56 h-32 fileupload z-10"
                        onChange={(
                            event: React.ChangeEvent<HTMLInputElement>
                        ): void => {
                            if (event.target.files) {
                                const picked = event.target.files[0];
                                if (CONVERT_EXT_RE.test(picked.name)) {
                                    setFile(picked);
                                } else {
                                    dispatch(
                                        setGlobalState({
                                            errorMessage: t(
                                                'mediaMenu.invalidConvertFile'
                                            )
                                        })
                                    );
                                    event.target.value = '';
                                }
                            }
                        }}
                        type="file"
                    ></input>
                </div>
            )}
            {file && (
                <>
                    <div className="mb-3 truncate">{file.name}</div>
                    {isProbing && (
                        <div className="mb-3 text-sm text-gray-300">
                            {progress < 100
                                ? `${t(
                                      'mediaMenu.uploadingLabel'
                                  )} ${progress}%`
                                : t('mediaMenu.probingLabel')}
                        </div>
                    )}
                    <Button
                        onClick={(): void => setFile(null)}
                        className="mt-1 mb-2 mr-2"
                        color="text-gray-200 hover:text-gray-400"
                        text={t('mediaMenu.clearLabel')}
                    ></Button>
                    <Button
                        type="submit"
                        onClick={(event: React.MouseEvent): Promise<void> =>
                            uploadAndProbe(event)
                        }
                        className="mt-1"
                        disabled={isProbing}
                        text={
                            isProbing
                                ? t('mediaMenu.uploadingLabel')
                                : t('mediaMenu.uploadLabel')
                        }
                    ></Button>
                </>
            )}
        </form>
    );
};
