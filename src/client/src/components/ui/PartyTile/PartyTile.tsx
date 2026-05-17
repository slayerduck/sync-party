import { useTranslation } from 'react-i18next';
import { Avatar } from '../../display/Avatar/Avatar';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCog, faPlay } from '@fortawesome/free-solid-svg-icons';
import { useDispatch } from 'react-redux';
import { setGlobalState } from '../../../actions/globalActions';

import type { ReactElement } from 'react';
import type {
    ClientParty,
    PartyMember,
    ClientUser
} from '../../../../../shared/types';

interface Props {
    user: ClientUser;
    userParty: ClientParty;
    handlePartyChoose: (userParty: ClientParty) => void;
    setRedirectToPartySettings: (partyId: string) => void;
}

export const PartyTile = ({
    user,
    userParty,
    handlePartyChoose,
    setRedirectToPartySettings
}: Props): ReactElement => {
    const dispatch = useDispatch();
    const { t } = useTranslation();
    const isActive = userParty.status === 'active';
    const canJoin = isActive || user.role === 'admin';

    const onClick = (): void => {
        if (canJoin) {
            handlePartyChoose(userParty);
        } else {
            dispatch(
                setGlobalState({
                    errorMessage: t(`errors.joinInactivePartyError`)
                })
            );
        }
    };

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={onClick}
            onKeyDown={(e): void => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onClick();
                }
            }}
            title={t('dashboard.partyTileTitle')}
            className={
                'group relative flex flex-col rounded-xl border bg-white/5 hover:bg-white/10 border-white/10 hover:border-white/20 p-4 transition-all cursor-pointer hover:-translate-y-0.5 hover:shadow-lg hover:shadow-purple-900/20 ' +
                (canJoin ? '' : 'opacity-70')
            }
        >
            <div className="flex items-center justify-between mb-3">
                <span
                    className={
                        'inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full ' +
                        (isActive
                            ? 'bg-green-500/15 text-green-400 border border-green-500/30'
                            : 'bg-red-500/15 text-red-400 border border-red-500/30')
                    }
                >
                    <span
                        className={
                            'w-1.5 h-1.5 rounded-full ' +
                            (isActive ? 'bg-green-400' : 'bg-red-400')
                        }
                    ></span>
                    {isActive
                        ? t('common.statusActive')
                        : t('common.statusStopped')}
                </span>
                {user.role === 'admin' && (
                    <button
                        type="button"
                        onClick={(event): void => {
                            event.stopPropagation();
                            setRedirectToPartySettings(userParty.id);
                        }}
                        title={t('dashboard.editPartyTitle')}
                        className="text-gray-400 hover:text-gray-100 p-1 rounded transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                    >
                        <FontAwesomeIcon icon={faCog} />
                    </button>
                )}
            </div>

            <div className="flex-1 mb-3 min-h-[1.5rem]">
                <div className="font-medium text-gray-100 truncate">
                    {userParty.name}
                </div>
            </div>

            <div className="flex items-center justify-between">
                <div className="flex -space-x-1.5">
                    {userParty.members
                        .slice(0, 6)
                        .map((member: PartyMember) => (
                            <div
                                key={member.username}
                                className="ring-2 ring-[#0a0a0f] rounded-full"
                            >
                                <Avatar
                                    size={8}
                                    fontSize={'text-xs'}
                                    username={member.username}
                                    user={user}
                                />
                            </div>
                        ))}
                    {userParty.members.length > 6 && (
                        <div className="ring-2 ring-[#0a0a0f] rounded-full bg-gray-700 w-8 h-8 flex items-center justify-center text-xs text-gray-200">
                            +{userParty.members.length - 6}
                        </div>
                    )}
                </div>
                <FontAwesomeIcon
                    icon={faPlay}
                    className="text-purple-400 opacity-0 group-hover:opacity-100 transition-opacity"
                    size="sm"
                />
            </div>
        </div>
    );
};
