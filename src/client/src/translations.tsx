export const translations = {
    en: {
        translation: {
            common: {
                title: 'Sync Party',
                login: 'Login',
                submit: 'Submit',
                logout: 'Logout',
                username: 'Username',
                password: 'Password',
                name: 'Name',
                next: 'Next',
                back: 'Back',
                loggedInAs: 'Logged in as',
                nowPlaying: 'Now on air',
                media: 'Media Items',
                chooseMedia:
                    'Choose a media item from the list below to start your Sync Party!',
                statusActive: 'active',
                statusStopped: 'stopped',
                user: 'User',
                userLinkTitle: 'Go to your user settings',
                close: 'Close',
                online: 'online',
                offline: 'offline',
                add: 'Add',
                approx: 'approx.',
                minLeft: 'min. left',
                party: 'Party',
                fullscreen: 'Toggle fullscreen'
            },
            player: {
                backToDashboardTitle: 'Back to Dashboard',
                goToPartyTitle: 'Edit party',
                greeting: 'Hi there!',
                greetingText:
                    'Choose a media item from the list to start your Sync Party.',
                doNotLeave:
                    'Do you really want to leave? You might experience problems with the media player coming back'
            },
            mediaMenu: {
                addMedia: 'Add media',
                addMediaTitle: 'Click to open the Add media dialog',
                mediaItemClickPlayTitle: 'Click to play',
                mediaItemClickAddTitle: 'Click to add item to party',
                mediaItemRemoveTitle: 'Click to remove from party',
                addWebTab: 'Add media from the web',
                addUserTab: 'Add media from your files',
                addFileTab: 'Upload a file',
                addWebDescription: 'Add media from the web',
                addWebUrl: 'URL',
                addNameDescription: 'Name your item',
                addFileDragDrop: 'Drag & drop a file here',
                addFileUploadDialog: '(Or click to open upload dialog)',
                collapseTitle: 'Collapse menu',
                editButtonTitle: 'Edit item name',
                userItemsEmpty: 'Currently there are no items.',
                userItemsUpload:
                    'Feel free to upload an item or add media from the web.',
                uploadFinished: 'Upload finished. File: ',
                addingFinished: 'New item was added. Name: ',
                uploadError: 'An error occured during the upload.',
                uploadLabel: 'Upload',
                clearLabel: 'Clear',
                download: 'Download',
                copy: 'Copy URL to Clipboard',
                invalidFileType: 'This file type is not supported.',
                addZipTab: 'Upload a zip with multiple files',
                addZipDragDrop: 'Drag & drop a .zip here',
                addZipUploadDialog: '(Or click to open upload dialog)',
                invalidZipFile: 'Please select a .zip archive.',
                uploadZipLabel: 'Upload zip',
                zipAddedCount: '{{count}} files added from zip',
                zipQueuedConverting:
                    '{{count}} files from zip queued for conversion',
                zipPickTracksHint:
                    '{{count}} videos in the zip need conversion. Picked from "{{name}}". The same audio/subtitle choice will be applied to every file.',
                addConvertTab: 'Upload a video to convert / normalize',
                addConvertDragDrop:
                    'Drag & drop a video here (mp4 will be re-encoded for normalization)',
                addConvertUploadDialog: '(Or click to open upload dialog)',
                invalidConvertFile:
                    'Choose a video file (mp4, mkv, avi, mov, etc.).',
                uploadingLabel: 'Uploading...',
                probingLabel: 'Probing tracks...',
                probeError: 'Could not probe the uploaded file.',
                convertAudioTrack: 'Audio track',
                convertSubtitleTrack: 'Subtitle track',
                convertNoSubtitle: 'No subtitles',
                convertNoAudio: 'No audio track found',
                convertBurnSubtitles:
                    'Burn subtitles into the video (re-encodes video)',
                startConversion: 'Start conversion',
                startingConversion: 'Starting...',
                conversionStartError: 'Could not start the conversion.',
                statusConverting: 'Converting...',
                statusFailed: 'Conversion failed',
                statusNeedsConversion: 'Needs conversion',
                addChannelTitle: 'Add channel title',
                removeChannelTitle: 'Remove channel title',
                filter: 'Search',
                noFilterResults: 'No results.'
            },
            chat: {
                writeSomething: 'Write something',
                open: 'Enable Chat',
                close: 'Disable Chat',
                me: 'Me'
            },
            webRtc: {
                audioOpen: 'Join audio call',
                audioClose: 'Quit audio call',
                videoOpen: 'Join video call',
                videoClose: 'Quit video call',
                muteAudio: 'Mute my audio',
                unmuteAudio: 'Unmute my audio',
                muteVideo: 'Deactivate my video',
                unmuteVideo: 'Activate my video',
                missingPermissionsVideo:
                    'Camera and microphone permissions are necessary',
                missingPermissionsAudio: 'Microphone permission is necessary',
                noCamera: 'No camera found',
                noMicrophone: 'No microphone found',
                abortError:
                    'Error accessing your camera and/or microphone. Might they already be in use?',
                showVideos: 'Show videos',
                hideVideos: 'Hide videos',
                toggleUserVideoOn: 'Display own video',
                toggleUserVideoOff: 'Hide own video',
                displayVertically: 'Arrange videos vertically',
                displayHorizontally: 'Arrange video horizontally',
                fullscreen: 'Toggle videochat fullscreen'
            },
            dashboard: {
                greeting: 'Hi, {{name}}',
                subheading:
                    'Pick a party to join, or spin up a new one to get watching.',
                newParty: 'Create a new party',
                yourParties: 'Your Parties',
                partyTileTitle: 'Click to join the party',
                noParties:
                    "You're not in any parties yet. Create one above to get started.",
                allMedia: 'All media',
                yourMedia: 'Your media',
                processingFiles: 'Processing files',
                processingFilesTitle:
                    'Resume audio/subtitle picks for zip uploads that are still waiting',
                convertUpload: 'Upload & convert',
                convertUploadTitle:
                    'Upload a video to convert and add it to a room, without joining the player',
                screenShare: 'Screen share',
                screenShareTitle:
                    'Open the shared screen-share channel (one streamer, everyone else watches)',
                editPartyTitle: 'Edit Party',
                createParty: 'Create'
            },
            streaming: {
                heading: 'Screen share',
                share: 'Share screen',
                stop: 'Stop sharing',
                someoneElseSharing: 'Someone else is sharing',
                expand: 'Expand viewer',
                shrink: 'Shrink viewer',
                connecting: 'Connecting…'
            },
            screenShare: {
                idleHint:
                    'No one is sharing right now. Share your screen and everyone here will see it.',
                diagnostics: 'Connection diagnostics',
                noAudio:
                    'No audio is being shared. A single window has no audio in any browser — to send sound, use Chrome and share a "Chrome Tab" or "Entire Screen", ticking "Share tab/system audio" in the picker. Or enable "Share my microphone" before sharing.',
                audioTip:
                    'For sound: share a "Chrome Tab" or "Entire Screen" (not a single window) and tick "Share tab/system audio". A window share is video-only.',
                shareMic: 'Also share my microphone',
                enableSound: 'Enable sound',
                mute: 'Mute',
                unmute: 'Unmute',
                volume: 'Volume'
            },
            convertUpload: {
                heading: 'Upload & convert',
                description:
                    'Upload one or more videos here to convert and normalize them, then add them to a room. Doing this from the dashboard avoids uploading while the player is running.',
                targetRoom: 'Add to room',
                noRooms: 'You are not a member of any room yet.',
                dropHint:
                    'Click to choose a video (mp4, mkv, avi, mov, …) — it will be re-encoded for normalization',
                dropHintMulti:
                    'Click to choose one or more videos (mp4, mkv, avi, mov, …) — each is re-encoded for normalization',
                queued: 'Started converting "{{name}}". It will appear in {{party}} once it is ready.',
                targetingRoom: 'To room: {{party}}',
                removeJob: 'Remove'
            },
            processing: {
                heading: 'Processing files',
                loading: 'Loading pending uploads…',
                empty: 'Nothing to process. New zip uploads waiting for track selection and any failed conversions will appear here.',
                pendingHeading: 'Waiting for track selection',
                failedHeading: 'Conversion failed — retry',
                jobTitle: '{{count}} videos waiting for track selection',
                sampledFrom: 'Tracks sampled from "{{name}}"',
                retry: 'Retry conversion',
                logFile: 'Log:'
            },
            mediaItems: {
                headingUser: 'Your Media Items',
                headingAdmin: 'All Media Items',
                name: 'Name',
                type: 'Type',
                owner: 'Owner',
                url: 'URL / filename',
                id: 'ID',
                createdAt: 'Created',
                updatedAt: 'Updated',
                actions: 'Actions',
                delete: 'Delete'
            },
            editParty: {
                heading: 'Edit Party',
                stopParty: 'Stop Party',
                resumeParty: 'Resume Party',
                deleteParty: 'Delete Party',
                headingEditMembers: 'Edit Party Members',
                headingMembers: 'Members (click to remove)',
                headingNonMembers: 'Non-members (click to add)'
            },
            validation: {
                usernameMissing: 'Username cannot be empty',
                passwordMissing: 'Password cannot be empty'
            },
            errors: {
                userItemFetchError: 'Error getting your MediaItems.',
                userPartyFetchError: 'Error getting your parties.',
                partyCreationError: 'Error creating new party.',
                userFetchError: 'Error fetching users.',
                editPartyError: 'Error saving edited party.',
                itemFetchError: 'Error getting MediaItems',
                uploadError: 'Error at upload',
                addItemError: 'Error adding item',
                addToPartyError: 'Error adding item to party',
                removeItemError: 'Error removing item from party',
                removeLastItemError:
                    'You cannot remove the last playing item from the playlist.',
                deleteItemError: 'Error deleting item',
                itemSaveError: 'Error editing item',
                reorderError: 'Error reordering items in playlist',
                logoutError: 'Error logging out',
                metadataUpdateError: 'Error updating metadata',
                joinInactivePartyError: 'You cannot join an inactive party.',
                pendingZipFetchError:
                    'Could not load pending uploads from the server.'
            },
            alerts: {
                yes: 'Yes',
                no: 'No',
                continueFromLastPosition: 'Continue from last position?'
            },
            apiResponseMessages: {
                // Not used in client atm
                noSessionOrUser: 'No session or no user',
                notAuthenticated: 'Not authenticated',
                notAuthorized: 'Not authorized',
                csrfToken: 'CSRF token missing',
                sessionFound: 'Session found',
                missingFields: 'Missing fields',
                wrongUsernameOrPassword: 'Wrong username or password',
                loginSuccessful: 'Login successful',
                logoutSuccessful: 'Logout successful',
                noFileAccess: 'No file access',
                fileUploadError: "File already exists or something's missing",
                uploadSuccessful: 'Upload successful',
                fetchingSuccessful: 'MediaItem fetching successful',
                userFetchingSuccessful: 'User fetching successful',
                noUsers: 'No users',
                mediaItemAddSuccessful: 'MediaItem added',
                mediaItemEditSuccessful: 'MediaItem edited',
                mediaItemDeleteSuccessful: 'MediaItem deleted',
                validationError: 'Validation Error',
                createPartySuccessful: 'Party created',
                partyEditSuccessful: 'Party edited or deleted',
                addUserSuccessful: 'User added to party',
                addItemSuccessful: 'Item added to party',
                itemsUpdateSuccessful: 'Item order updated',
                metadataUpdateSuccessful: 'Party Metadata updated',
                removePartyItemSuccessful: 'Item removed from party',
                partyWithSameName: 'Party with that name already exists',
                userAlreadyInParty: 'User already in party',
                itemAlreadyInParty: 'Item already in party',
                error: 'An error occurred.'
            }
        }
    }
};
