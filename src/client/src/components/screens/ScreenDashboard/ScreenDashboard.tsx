import { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { setGlobalState } from '../../../actions/globalActions';

import Axios from 'axios';
import {
    axiosConfig,
    updateCurrentParty,
    noPartyState
} from '../../../common/helpers';
import { useTranslation } from 'react-i18next';

import { getUpdatedUserParties } from '../../../common/requests';
import { Alert } from '../../display/Alert/Alert';
import { DuckBackground } from '../../display/DuckBackground/DuckBackground';
import { PartyTile } from '../../ui/PartyTile/PartyTile';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faUser,
    faHdd,
    faPlus,
    faUsers,
    faSpinner
} from '@fortawesome/free-solid-svg-icons';
import { Navigate } from 'react-router-dom';

import type { ClientParty, RootAppState } from '../../../../../shared/types';
import type { Socket } from 'socket.io-client';

type Props = {
    socket: Socket | null;
};

export const ScreenDashboard = (props: Props): JSX.Element | null => {
    const [redirectToParty, setRedirectToParty] = useState('');
    const [redirectToUser, setRedirectToUser] = useState(false);
    const [redirectToMediaItems, setRedirectToMediaItems] = useState(false);
    const [redirectToProcessing, setRedirectToProcessing] = useState(false);
    const [redirectToPartySettings, setRedirectToPartySettings] = useState('');
    const [partyName, setPartyName] = useState('');
    const [creating, setCreating] = useState(false);
    const userParties = useSelector(
        (state: RootAppState) => state.globalState.userParties
    );
    const party = useSelector((state: RootAppState) => state.globalState.party);
    const user = useSelector((state: RootAppState) => state.globalState.user);
    const errorMessage = useSelector(
        (state: RootAppState) => state.globalState.errorMessage
    );
    const dispatch = useDispatch();
    const { t } = useTranslation();

    useEffect(() => {
        if (props.socket && party && !redirectToParty) {
            props.socket.emit('leaveParty', { partyId: party.id });
            dispatch(setGlobalState(noPartyState));
        }
    }, [props.socket, party, dispatch, redirectToParty]);

    const handleCreateParty = async (event: React.FormEvent): Promise<void> => {
        event.preventDefault();
        if (!partyName.trim() || creating) return;

        setCreating(true);
        try {
            const response = await Axios.post(
                '/api/party',
                { partyName: partyName.trim() },
                axiosConfig()
            );
            if (response.data.success) {
                const updatedUserParties = await getUpdatedUserParties(
                    dispatch,
                    t
                );
                if (party) {
                    await updateCurrentParty(
                        dispatch,
                        updatedUserParties,
                        party
                    );
                }
                setPartyName('');
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
                    errorMessage: t(`errors.partyCreationError`)
                })
            );
            return Promise.reject(error);
        } finally {
            setCreating(false);
        }
    };

    const handlePartyChoose = (userParty: ClientParty): void => {
        dispatch(setGlobalState({ party: userParty }));
        setRedirectToParty(userParty.id);
    };

    if (redirectToParty !== '') {
        return <Navigate to={'/party/' + redirectToParty}></Navigate>;
    }

    if (redirectToPartySettings !== '') {
        return (
            <Navigate to={'/editParty/' + redirectToPartySettings}></Navigate>
        );
    }

    if (redirectToUser) {
        return <Navigate to={'/user'}></Navigate>;
    }

    if (redirectToMediaItems) {
        return <Navigate to={'/mediaItems'}></Navigate>;
    }

    if (redirectToProcessing) {
        return <Navigate to={'/processing'}></Navigate>;
    }

    const parties = userParties || [];
    const hasParties = parties.length > 0;

    return (
        <div
            className="relative min-h-screen w-full text-gray-100 overflow-hidden"
            style={{
                background:
                    'radial-gradient(1200px 600px at 20% -10%, rgba(159,122,234,0.18), transparent 60%), radial-gradient(900px 500px at 100% 10%, rgba(94,240,155,0.10), transparent 60%), #0a0a0f'
            }}
        >
            <DuckBackground />
            <header className="sticky top-0 z-30 backdrop-blur bg-black/40 border-b border-white/10">
                <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span
                            className="inline-block w-2.5 h-2.5 rounded-full"
                            style={{ backgroundColor: '#9f7aea' }}
                        ></span>
                        <span className="font-semibold tracking-wide">
                            {t('common.title')}
                        </span>
                    </div>
                    {user && (
                        <button
                            type="button"
                            onClick={(): void => setRedirectToUser(true)}
                            title={t('common.userLinkTitle')}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 transition-colors text-sm"
                        >
                            <FontAwesomeIcon icon={faUser} size="sm" />
                            <span>{user.username}</span>
                        </button>
                    )}
                </div>
            </header>

            {errorMessage && (
                <div className="w-full absolute z-40">
                    <div className="mx-auto mt-4 max-w-lg px-4">
                        <Alert
                            className="w-full"
                            mode="error"
                            text={errorMessage}
                            onCloseButton={(): void => {
                                dispatch(setGlobalState({ errorMessage: '' }));
                            }}
                        ></Alert>
                    </div>
                </div>
            )}

            {user && (
                <main className="max-w-5xl mx-auto px-4 pt-8 pb-16">
                    <div className="mb-8">
                        <h1 className="text-2xl sm:text-3xl font-semibold mb-1">
                            {t('dashboard.greeting', { name: user.username })}
                        </h1>
                        <p className="text-sm text-gray-400">
                            {t('dashboard.subheading')}
                        </p>
                    </div>

                    {user.role === 'admin' && (
                        <form
                            onSubmit={handleCreateParty}
                            className="mb-10 rounded-xl border border-white/10 bg-white/5 p-4 sm:p-5"
                        >
                            <label className="block text-xs uppercase tracking-wider text-gray-400 mb-2">
                                {t('dashboard.newParty')}
                            </label>
                            <div className="flex flex-col sm:flex-row gap-2">
                                <input
                                    type="text"
                                    value={partyName}
                                    placeholder={t('common.name')}
                                    onChange={(
                                        e: React.ChangeEvent<HTMLInputElement>
                                    ): void => setPartyName(e.target.value)}
                                    className="flex-1 rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/60 focus:border-transparent"
                                />
                                <button
                                    type="submit"
                                    disabled={
                                        creating ||
                                        partyName.trim().length === 0
                                    }
                                    className="rounded-lg px-4 py-2 text-sm font-medium bg-purple-600 hover:bg-purple-500 disabled:bg-purple-900 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                                >
                                    <FontAwesomeIcon icon={faPlus} size="sm" />
                                    {t('dashboard.createParty')}
                                </button>
                            </div>
                        </form>
                    )}

                    <section>
                        <div className="flex items-baseline justify-between mb-4">
                            <h2 className="text-lg font-semibold flex items-center gap-2">
                                <FontAwesomeIcon
                                    icon={faUsers}
                                    className="text-purple-400"
                                />
                                {t('dashboard.yourParties')}
                            </h2>
                            <span className="text-xs text-gray-500">
                                {parties.length}
                            </span>
                        </div>

                        {hasParties ? (
                            <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
                                {parties.map((userParty: ClientParty) => (
                                    <PartyTile
                                        key={userParty.id}
                                        user={user}
                                        userParty={userParty}
                                        handlePartyChoose={handlePartyChoose}
                                        setRedirectToPartySettings={
                                            setRedirectToPartySettings
                                        }
                                    />
                                ))}
                            </div>
                        ) : (
                            <div className="rounded-xl border border-dashed border-white/10 bg-white/5 p-8 text-center">
                                <FontAwesomeIcon
                                    icon={faUsers}
                                    size="2x"
                                    className="text-gray-600 mb-3"
                                />
                                <p className="text-sm text-gray-400">
                                    {t('dashboard.noParties')}
                                </p>
                            </div>
                        )}
                    </section>

                    <div className="mt-10 flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={(): void => setRedirectToMediaItems(true)}
                            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
                        >
                            <FontAwesomeIcon
                                icon={faHdd}
                                className="text-gray-400"
                            />
                            {user.role === 'admin'
                                ? t('dashboard.allMedia')
                                : t('dashboard.yourMedia')}
                        </button>
                        <button
                            type="button"
                            onClick={(): void => setRedirectToProcessing(true)}
                            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
                            title={t('dashboard.processingFilesTitle')}
                        >
                            <FontAwesomeIcon
                                icon={faSpinner}
                                className="text-gray-400"
                            />
                            {t('dashboard.processingFiles')}
                        </button>
                    </div>

                    <div className="mt-16 text-xs text-center text-gray-600">
                        v{APP_VERSION}
                    </div>
                </main>
            )}
        </div>
    );
};
