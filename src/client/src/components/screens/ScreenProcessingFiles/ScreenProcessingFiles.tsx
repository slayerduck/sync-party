import { useState, useEffect, useCallback } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import Axios from 'axios';

import { axiosConfig } from '../../../common/helpers';
import { setGlobalState } from '../../../actions/globalActions';
import { ConvertTrackPicker } from '../../ui/ConvertTrackPicker/ConvertTrackPicker';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faArrowLeft,
    faSpinner,
    faFolderOpen,
    faTriangleExclamation
} from '@fortawesome/free-solid-svg-icons';

import type { ReactElement } from 'react';
import type { ConvertTrackInfo } from '../../../../../shared/types';

type Tracks = {
    audio: ConvertTrackInfo[];
    subtitle: ConvertTrackInfo[];
};

type PendingJob = {
    zipJobId: string;
    partyId: string;
    partyName: string;
    convertCount: number;
    sample: {
        originalName: string;
        duration: number | null;
        tracks: Tracks;
    };
};

type FailedJob = {
    itemId: string;
    partyId: string;
    partyName: string;
    originalName: string;
    displayName: string;
    errorMessage: string;
    logFile?: string;
    failedAt: number;
    tracks: Tracks;
};

export const ScreenProcessingFiles = (): ReactElement => {
    const { t } = useTranslation();
    const dispatch = useDispatch();
    const [redirectHome, setRedirectHome] = useState(false);
    const [loading, setLoading] = useState(true);
    const [jobs, setJobs] = useState<PendingJob[]>([]);
    const [failed, setFailed] = useState<FailedJob[]>([]);
    const [busyId, setBusyId] = useState<string | null>(null);

    const loadJobs = useCallback(async (): Promise<void> => {
        try {
            const res = await Axios.get('/api/pendingZipJobs', axiosConfig());
            if (res.data.success) {
                setJobs(res.data.jobs || []);
                setFailed(res.data.failed || []);
            }
        } catch {
            dispatch(
                setGlobalState({
                    errorMessage: t('errors.pendingZipFetchError')
                })
            );
        } finally {
            setLoading(false);
        }
    }, [dispatch, t]);

    useEffect(() => {
        loadJobs();
    }, [loadJobs]);

    const handleFinalize = async (
        job: PendingJob,
        choice: {
            audioIndex: number;
            subtitleIndex: number | null;
            burnSubtitles: boolean;
        }
    ): Promise<void> => {
        setBusyId(job.zipJobId);
        try {
            const res = await Axios.post(
                `/api/file/zip/${job.zipJobId}/finalize`,
                choice,
                axiosConfig()
            );
            if (res.data.success) {
                setJobs((cur) =>
                    cur.filter((j) => j.zipJobId !== job.zipJobId)
                );
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
            setBusyId(null);
        }
    };

    const handleCancel = async (job: PendingJob): Promise<void> => {
        setBusyId(job.zipJobId);
        try {
            await Axios.delete(`/api/file/zip/${job.zipJobId}`, axiosConfig());
        } catch {
            // best effort
        } finally {
            setJobs((cur) => cur.filter((j) => j.zipJobId !== job.zipJobId));
            setBusyId(null);
        }
    };

    const handleRetry = async (
        job: FailedJob,
        choice: {
            audioIndex: number;
            subtitleIndex: number | null;
            burnSubtitles: boolean;
        }
    ): Promise<void> => {
        setBusyId(job.itemId);
        try {
            const res = await Axios.post(
                `/api/file/convert/retry/${job.itemId}`,
                choice,
                axiosConfig()
            );
            if (res.data.success) {
                setFailed((cur) => cur.filter((f) => f.itemId !== job.itemId));
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
            setBusyId(null);
        }
    };

    const handleDiscard = async (job: FailedJob): Promise<void> => {
        setBusyId(job.itemId);
        try {
            await Axios.delete(
                `/api/file/convert/failed/${job.itemId}`,
                axiosConfig()
            );
        } catch {
            // best effort
        } finally {
            setFailed((cur) => cur.filter((f) => f.itemId !== job.itemId));
            setBusyId(null);
        }
    };

    if (redirectHome) {
        return <Navigate to={'/'}></Navigate>;
    }

    const isEmpty = jobs.length === 0 && failed.length === 0;

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
                        {t('processing.heading')}
                    </span>
                </div>
            </header>

            <main className="max-w-3xl mx-auto px-4 pt-8 pb-16">
                {loading ? (
                    <div className="flex items-center gap-2 text-gray-400">
                        <FontAwesomeIcon icon={faSpinner} spin />
                        {t('processing.loading')}
                    </div>
                ) : isEmpty ? (
                    <div className="rounded-xl border border-dashed border-white/10 bg-white/5 p-8 text-center">
                        <FontAwesomeIcon
                            icon={faFolderOpen}
                            size="2x"
                            className="text-gray-600 mb-3"
                        />
                        <p className="text-sm text-gray-400">
                            {t('processing.empty')}
                        </p>
                    </div>
                ) : (
                    <>
                        {jobs.length > 0 && (
                            <section className="mb-10">
                                <h2 className="text-sm uppercase tracking-wider text-gray-400 mb-3">
                                    {t('processing.pendingHeading')}
                                </h2>
                                <div className="space-y-4">
                                    {jobs.map((job) => (
                                        <div
                                            key={job.zipJobId}
                                            className="rounded-xl border border-white/10 bg-white/5 p-4 sm:p-5"
                                        >
                                            <div className="mb-3">
                                                <div className="text-sm text-gray-400">
                                                    {job.partyName
                                                        ? `${t(
                                                              'common.party'
                                                          )}: ${job.partyName}`
                                                        : `${t(
                                                              'common.party'
                                                          )}: —`}
                                                </div>
                                                <div className="font-medium">
                                                    {t('processing.jobTitle', {
                                                        count: job.convertCount
                                                    })}
                                                </div>
                                                <div className="text-xs text-gray-500 truncate">
                                                    {t(
                                                        'processing.sampledFrom',
                                                        {
                                                            name: job.sample
                                                                .originalName
                                                        }
                                                    )}
                                                </div>
                                            </div>
                                            <ConvertTrackPicker
                                                tracks={job.sample.tracks}
                                                submitLabel={t(
                                                    'mediaMenu.startConversion'
                                                )}
                                                submittingLabel={t(
                                                    'mediaMenu.startingConversion'
                                                )}
                                                busy={busyId === job.zipJobId}
                                                onSubmit={(c): void => {
                                                    handleFinalize(job, c);
                                                }}
                                                onCancel={(): void => {
                                                    handleCancel(job);
                                                }}
                                            />
                                        </div>
                                    ))}
                                </div>
                            </section>
                        )}

                        {failed.length > 0 && (
                            <section>
                                <h2 className="text-sm uppercase tracking-wider text-gray-400 mb-3 flex items-center gap-2">
                                    <FontAwesomeIcon
                                        icon={faTriangleExclamation}
                                        className="text-amber-400"
                                    />
                                    {t('processing.failedHeading')}
                                </h2>
                                <div className="space-y-4">
                                    {failed.map((job) => (
                                        <div
                                            key={job.itemId}
                                            className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 sm:p-5"
                                        >
                                            <div className="mb-3">
                                                <div className="text-sm text-gray-400">
                                                    {job.partyName
                                                        ? `${t(
                                                              'common.party'
                                                          )}: ${job.partyName}`
                                                        : `${t(
                                                              'common.party'
                                                          )}: —`}
                                                </div>
                                                <div className="font-medium">
                                                    {job.displayName}
                                                </div>
                                                <div className="text-xs text-gray-500 truncate">
                                                    {job.originalName}
                                                </div>
                                                <div className="mt-2 text-xs text-red-300 font-mono break-words">
                                                    {job.errorMessage}
                                                </div>
                                                {job.logFile && (
                                                    <div className="mt-1 text-[10px] text-gray-500 font-mono">
                                                        {t(
                                                            'processing.logFile'
                                                        )}{' '}
                                                        {job.logFile}
                                                    </div>
                                                )}
                                            </div>
                                            <ConvertTrackPicker
                                                tracks={job.tracks}
                                                submitLabel={t(
                                                    'processing.retry'
                                                )}
                                                submittingLabel={t(
                                                    'mediaMenu.startingConversion'
                                                )}
                                                busy={busyId === job.itemId}
                                                onSubmit={(c): void => {
                                                    handleRetry(job, c);
                                                }}
                                                onCancel={(): void => {
                                                    handleDiscard(job);
                                                }}
                                            />
                                        </div>
                                    ))}
                                </div>
                            </section>
                        )}
                    </>
                )}
            </main>
        </div>
    );
};
