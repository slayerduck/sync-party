import { useState, useEffect, useCallback, useRef } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import Axios from 'axios';
import { v4 as uuid } from 'uuid';

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
    faCircleCheck,
    faCircleXmark,
    faTrashCan
} from '@fortawesome/free-solid-svg-icons';

import type { ReactElement } from 'react';
import type {
    ClientParty,
    ConvertUploadResponse
} from '../../../../../shared/types';

const CONVERT_EXT_RE =
    /\.(mp4|m4v|mkv|avi|mov|ts|m2ts|wmv|flv|ogv|3gp|vob|webm)$/i;

type JobStatus =
    | 'uploading'
    | 'probed'
    | 'finalizing'
    | 'converting'
    | 'ready'
    | 'failed';

type ConvertJob = {
    id: string;
    fileName: string;
    status: JobStatus;
    uploadProgress: number;
    convertPercent: number | null;
    probed: ConvertUploadResponse | null;
    name: string;
    error?: string;
    itemId?: string;
    targetPartyId?: string;
    targetPartyName?: string;
};

const ProgressBar = ({ percent }: { percent: number }): ReactElement => (
    <div className="w-full h-1.5 mt-2 bg-gray-800 rounded overflow-hidden">
        <div
            className="h-1.5 bg-purple-500 transition-[width] duration-300"
            style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
        ></div>
    </div>
);

export const ScreenConvertUpload = (): ReactElement => {
    const { t } = useTranslation();
    const dispatch = useDispatch();

    const [redirectHome, setRedirectHome] = useState(false);
    const [parties, setParties] = useState<ClientParty[]>([]);
    const [partyId, setPartyId] = useState<string>('');
    const [jobs, setJobs] = useState<ConvertJob[]>([]);

    const jobsRef = useRef(jobs);
    useEffect(() => {
        jobsRef.current = jobs;
    }, [jobs]);

    const updateJob = useCallback(
        (id: string, patch: Partial<ConvertJob>): void => {
            setJobs((cur) =>
                cur.map((j) => (j.id === id ? { ...j, ...patch } : j))
            );
        },
        []
    );

    const removeJob = useCallback((id: string): void => {
        setJobs((cur) => cur.filter((j) => j.id !== id));
    }, []);

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

    const uploadAndProbeJob = useCallback(
        async (jobId: string, file: File): Promise<void> => {
            const formData = new FormData();
            formData.append('file', file);
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
                            updateJob(jobId, { uploadProgress: pct });
                        }
                    }
                );
                if (response.data.success) {
                    updateJob(jobId, {
                        status: 'probed',
                        uploadProgress: 100,
                        probed: response.data,
                        name: response.data.originalName.replace(/\.[^.]+$/, '')
                    });
                } else {
                    updateJob(jobId, {
                        status: 'failed',
                        error: t('mediaMenu.probeError')
                    });
                }
            } catch {
                updateJob(jobId, {
                    status: 'failed',
                    error: t('errors.uploadError')
                });
            }
        },
        [updateJob, t]
    );

    const addFiles = useCallback(
        (files: FileList): void => {
            const accepted: { job: ConvertJob; file: File }[] = [];
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                if (!CONVERT_EXT_RE.test(file.name)) {
                    dispatch(
                        setGlobalState({
                            errorMessage: t('mediaMenu.invalidConvertFile')
                        })
                    );
                    continue;
                }
                accepted.push({
                    file,
                    job: {
                        id: uuid(),
                        fileName: file.name,
                        status: 'uploading',
                        uploadProgress: 0,
                        convertPercent: null,
                        probed: null,
                        name: ''
                    }
                });
            }
            if (accepted.length === 0) return;
            setJobs((cur) => [...cur, ...accepted.map((a) => a.job)]);
            for (const a of accepted) {
                uploadAndProbeJob(a.job.id, a.file);
            }
        },
        [dispatch, t, uploadAndProbeJob]
    );

    const finalizeJob = useCallback(
        async (
            job: ConvertJob,
            choice: {
                audioIndex: number;
                subtitleIndex: number | null;
                burnSubtitles: boolean;
            }
        ): Promise<void> => {
            if (!job.probed || !partyId || job.name.trim().length === 0) {
                return;
            }
            const targetParty = parties.find((p) => p.id === partyId);
            updateJob(job.id, {
                status: 'finalizing',
                targetPartyId: partyId,
                targetPartyName: targetParty ? targetParty.name : ''
            });
            try {
                const response = await Axios.post(
                    `/api/file/convert/${job.probed.pendingId}/finalize`,
                    {
                        name: job.name.trim(),
                        partyId,
                        audioIndex: choice.audioIndex,
                        subtitleIndex: choice.subtitleIndex,
                        burnSubtitles: choice.burnSubtitles
                    },
                    axiosConfig()
                );
                if (response.data.success) {
                    updateJob(job.id, {
                        status: 'converting',
                        itemId: response.data.itemId,
                        convertPercent: 0
                    });
                } else {
                    updateJob(job.id, {
                        status: 'probed',
                        error: t('mediaMenu.conversionStartError')
                    });
                    dispatch(
                        setGlobalState({
                            errorMessage: t('mediaMenu.conversionStartError')
                        })
                    );
                }
            } catch {
                updateJob(job.id, {
                    status: 'probed',
                    error: t('mediaMenu.conversionStartError')
                });
                dispatch(
                    setGlobalState({
                        errorMessage: t('mediaMenu.conversionStartError')
                    })
                );
            }
        },
        [partyId, parties, updateJob, dispatch, t]
    );

    const cancelJob = useCallback(
        async (job: ConvertJob): Promise<void> => {
            try {
                if (job.status === 'probed' && job.probed) {
                    await Axios.delete(
                        `/api/file/convert/${job.probed.pendingId}`,
                        axiosConfig()
                    );
                } else if (
                    (job.status === 'converting' || job.status === 'failed') &&
                    job.itemId
                ) {
                    await Axios.delete(
                        `/api/mediaItem/${job.itemId}`,
                        axiosConfig()
                    );
                }
            } catch {
                // best effort
            }
            removeJob(job.id);
        },
        [removeJob]
    );

    // Poll conversionProgress for any job currently in 'converting' state.
    useEffect(() => {
        let cancelled = false;
        const tick = async (): Promise<void> => {
            const converting = jobsRef.current.filter(
                (j) => j.status === 'converting' && j.itemId
            );
            if (converting.length === 0) return;
            await Promise.all(
                converting.map(async (j) => {
                    try {
                        const res = await Axios.get(
                            `/api/conversionProgress/${j.itemId}`,
                            axiosConfig()
                        );
                        if (cancelled) return;
                        const patch: Partial<ConvertJob> = {};
                        if (typeof res.data.percent === 'number') {
                            patch.convertPercent = res.data.percent;
                        }
                        if (res.data.status === 'ready') {
                            patch.status = 'ready';
                            patch.convertPercent = 100;
                        } else if (res.data.status === 'failed') {
                            patch.status = 'failed';
                            patch.error = t('mediaMenu.statusFailed');
                        }
                        if (Object.keys(patch).length > 0) {
                            updateJob(j.id, patch);
                        }
                    } catch {
                        // keep polling
                    }
                })
            );
        };
        const interval = setInterval(tick, 1500);
        return (): void => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [updateJob, t]);

    if (redirectHome) {
        return <Navigate to={'/'}></Navigate>;
    }

    const renderJob = (job: ConvertJob): ReactElement => {
        const borderClass =
            job.status === 'failed'
                ? 'border-red-500/30 bg-red-500/5'
                : job.status === 'ready'
                ? 'border-green-500/30 bg-green-500/5'
                : 'border-white/10 bg-white/5';

        return (
            <div
                key={job.id}
                className={`rounded-xl border p-4 sm:p-5 ${borderClass}`}
            >
                <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0">
                        <div className="text-sm text-gray-300 truncate">
                            {job.fileName}
                        </div>
                        {job.targetPartyName && (
                            <div className="text-xs text-gray-500">
                                {t('convertUpload.targetingRoom', {
                                    party: job.targetPartyName
                                })}
                            </div>
                        )}
                    </div>
                    {job.status !== 'finalizing' && (
                        <button
                            type="button"
                            onClick={(): void => {
                                cancelJob(job);
                            }}
                            title={t('convertUpload.removeJob')}
                            className="text-gray-400 hover:text-red-400 p-1"
                        >
                            <FontAwesomeIcon icon={faTrashCan} size="sm" />
                        </button>
                    )}
                </div>

                {job.status === 'uploading' && (
                    <>
                        <div className="text-xs text-gray-400 flex items-center gap-2">
                            <FontAwesomeIcon icon={faSpinner} spin size="sm" />
                            {job.uploadProgress < 100
                                ? `${t('mediaMenu.uploadingLabel')} ${
                                      job.uploadProgress
                                  }%`
                                : t('mediaMenu.probingLabel')}
                        </div>
                        <ProgressBar percent={job.uploadProgress} />
                    </>
                )}

                {job.status === 'probed' && job.probed && (
                    <div className="mt-2">
                        <InputText
                            value={job.name}
                            containerClassName="mb-3"
                            placeholder={t('mediaMenu.addNameDescription')}
                            onChange={(
                                e: React.ChangeEvent<HTMLInputElement>
                            ): void =>
                                updateJob(job.id, { name: e.target.value })
                            }
                        ></InputText>
                        <ConvertTrackPicker
                            tracks={job.probed.tracks}
                            defaults={job.probed.defaults}
                            submitLabel={t('mediaMenu.startConversion')}
                            submittingLabel={t('mediaMenu.startingConversion')}
                            busy={false}
                            onSubmit={(c): void => {
                                finalizeJob(job, c);
                            }}
                            onCancel={(): void => {
                                cancelJob(job);
                            }}
                        />
                    </div>
                )}

                {job.status === 'finalizing' && (
                    <div className="text-xs text-gray-400 flex items-center gap-2">
                        <FontAwesomeIcon icon={faSpinner} spin size="sm" />
                        {t('mediaMenu.startingConversion')}
                    </div>
                )}

                {job.status === 'converting' && (
                    <>
                        <div className="text-xs text-gray-300 flex items-center gap-2">
                            <FontAwesomeIcon icon={faSpinner} spin size="sm" />
                            {t('mediaMenu.statusConverting')}{' '}
                            {job.convertPercent !== null
                                ? `${job.convertPercent}%`
                                : ''}
                        </div>
                        <ProgressBar percent={job.convertPercent ?? 0} />
                    </>
                )}

                {job.status === 'ready' && (
                    <div className="text-sm text-green-300 flex items-center gap-2">
                        <FontAwesomeIcon icon={faCircleCheck} />
                        {t('convertUpload.queued', {
                            name: job.name.trim(),
                            party: job.targetPartyName ?? ''
                        })}
                    </div>
                )}

                {job.status === 'failed' && (
                    <div className="text-sm text-red-300 flex items-center gap-2">
                        <FontAwesomeIcon icon={faCircleXmark} />
                        {job.error || t('mediaMenu.statusFailed')}
                    </div>
                )}
            </div>
        );
    };

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

                <div className="rounded-xl border border-white/10 bg-white/5 p-4 sm:p-5 mb-6">
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
                            className="w-full mb-4 bg-gray-200 text-gray-900 rounded py-2 px-2"
                        >
                            {parties.map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.name}
                                </option>
                            ))}
                        </select>
                    )}

                    <div className="relative h-32">
                        <div className="w-full absolute top-0 left-0 border-dashed border-4 border-white/20 rounded-lg flex">
                            <div className="m-auto text-center px-4">
                                <FontAwesomeIcon
                                    icon={faFilm}
                                    className="text-gray-500 mb-2"
                                    size="lg"
                                />
                                <p className="text-sm text-gray-300">
                                    {t('convertUpload.dropHintMulti')}
                                </p>
                            </div>
                        </div>
                        <input
                            className="w-full h-32 opacity-0 cursor-pointer z-10 relative"
                            type="file"
                            multiple
                            disabled={parties.length === 0}
                            onChange={(e): void => {
                                if (!e.target.files) return;
                                addFiles(e.target.files);
                                e.target.value = '';
                            }}
                        ></input>
                    </div>
                </div>

                {jobs.length > 0 && (
                    <div className="space-y-3">
                        {jobs.map((job) => renderJob(job))}
                    </div>
                )}
            </main>
        </div>
    );
};
