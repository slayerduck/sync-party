import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';
import { setGlobalState } from '../../../actions/globalActions';
import { Button } from '../../input/Button/Button';

import type { ReactElement } from 'react';

interface Props {
    file: File | null;
    setFile: (file: File | null) => void;
    addZipItem: (event: React.MouseEvent) => Promise<void>;
    resetUploadForm: () => void;
}

export const AddMediaTabZip = ({
    file,
    setFile,
    addZipItem,
    resetUploadForm
}: Props): ReactElement => {
    const { t } = useTranslation();
    const dispatch = useDispatch();

    return (
        <form>
            {!file && (
                <div className="relative h-32">
                    <div className="w-full absolute top-0 left-0 border-dashed border-4 flex dropzone">
                        <div className="p-auto m-auto text-center">
                            <p>{t('mediaMenu.addZipDragDrop')}</p>
                            <p className="mt-6">
                                {t('mediaMenu.addZipUploadDialog')}
                            </p>
                        </div>
                    </div>
                    <input
                        className="w-56 h-32 fileupload z-10"
                        accept=".zip"
                        onChange={(
                            event: React.ChangeEvent<HTMLInputElement>
                        ): void => {
                            if (event.target.files) {
                                const picked = event.target.files[0];
                                if (/\.zip$/i.test(picked.name)) {
                                    setFile(picked);
                                } else {
                                    dispatch(
                                        setGlobalState({
                                            errorMessage: t(
                                                'mediaMenu.invalidZipFile'
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
                    <Button
                        onClick={(): void => resetUploadForm()}
                        className="mt-1 mb-2 mr-2"
                        color="text-gray-200 hover:text-gray-400"
                        text={t('mediaMenu.clearLabel')}
                    ></Button>
                    <Button
                        type="submit"
                        onClick={(event: React.MouseEvent): Promise<void> =>
                            addZipItem(event)
                        }
                        className="mt-1"
                        text={t('mediaMenu.uploadZipLabel')}
                    ></Button>
                </>
            )}
        </form>
    );
};
