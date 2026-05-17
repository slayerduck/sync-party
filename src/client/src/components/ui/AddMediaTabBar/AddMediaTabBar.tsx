import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faAngleUp,
    faCloudUploadAlt,
    faUser,
    faGlobe,
    faFileArchive,
    faFilm
} from '@fortawesome/free-solid-svg-icons';
import { useTranslation } from 'react-i18next';

import type { ReactElement } from 'react';
import type { AddMediaTab } from '../../../../../shared/types';

interface Props {
    activeTab: AddMediaTab;
    changeTab: (activeTab: AddMediaTab) => void;
    isUploading: boolean;
    toggleCollapseAddMediaMenu: React.MouseEventHandler;
}

type TabSpec = {
    id: AddMediaTab;
    icon: typeof faUser;
    titleKey: string;
};

const TABS: TabSpec[] = [
    { id: 'user', icon: faUser, titleKey: 'mediaMenu.addUserTab' },
    { id: 'web', icon: faGlobe, titleKey: 'mediaMenu.addWebTab' },
    { id: 'file', icon: faCloudUploadAlt, titleKey: 'mediaMenu.addFileTab' },
    { id: 'zip', icon: faFileArchive, titleKey: 'mediaMenu.addZipTab' },
    { id: 'convert', icon: faFilm, titleKey: 'mediaMenu.addConvertTab' }
];

export const AddMediaTabBar = ({
    activeTab,
    changeTab,
    isUploading,
    toggleCollapseAddMediaMenu
}: Props): ReactElement => {
    const { t } = useTranslation();

    return (
        <div className="flex flex-row mb-1 justify-between">
            <ul className="flex">
                {TABS.map((tab) => (
                    <li className="mr-3" key={tab.id}>
                        <button
                            className={
                                'inline-block border rounded py-1 px-3 mb-2 noOutline' +
                                (activeTab === tab.id
                                    ? ' text-black bg-white'
                                    : '')
                            }
                            onClick={(): void => changeTab(tab.id)}
                            title={t(tab.titleKey)}
                        >
                            <FontAwesomeIcon
                                className={
                                    activeTab === tab.id
                                        ? ' text-black bg-white'
                                        : ''
                                }
                                icon={tab.icon}
                            ></FontAwesomeIcon>
                        </button>
                    </li>
                ))}
            </ul>
            <div>
                {!isUploading && (
                    <div
                        className="p-1 cursor-pointer"
                        onClick={toggleCollapseAddMediaMenu}
                        title={t('mediaMenu.collapseTitle')}
                    >
                        <FontAwesomeIcon
                            className="text-gray-200 hover:text-gray-100"
                            size="lg"
                            icon={faAngleUp}
                        ></FontAwesomeIcon>
                    </div>
                )}
            </div>
        </div>
    );
};
