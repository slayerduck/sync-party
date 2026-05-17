import type { ReactElement } from 'react';

/**
 * Background duckie — dark-tinted, low-opacity rubber duck used as a
 * decorative flourish in the bottom-left of the dashboard.
 */
export const DuckBackground = (): ReactElement => (
    <div
        aria-hidden="true"
        className="pointer-events-none select-none absolute right-2 bottom-2 sm:right-6 sm:bottom-6 opacity-20"
        style={{ width: 180, maxWidth: '40vw' }}
    >
        <svg
            viewBox="0 0 200 170"
            xmlns="http://www.w3.org/2000/svg"
            style={{ width: '100%', height: 'auto' }}
        >
            {/* Body */}
            <path
                d="M30 130 C30 80, 80 55, 130 65 C170 72, 180 100, 175 120 C172 135, 155 145, 130 145 L55 145 C40 145, 30 140, 30 130 Z"
                fill="#7a5a14"
            />
            {/* Belly highlight */}
            <path
                d="M55 135 C55 120, 80 110, 120 115 C145 118, 160 125, 160 135 Z"
                fill="#8d6a18"
            />
            {/* Head */}
            <circle cx="60" cy="55" r="32" fill="#7a5a14" />
            {/* Head shine */}
            <path
                d="M50 30 C58 22, 75 22, 82 30"
                stroke="#8d6a18"
                strokeWidth="3"
                strokeLinecap="round"
                fill="none"
            />
            {/* Top tuft */}
            <path d="M58 22 C56 14, 66 14, 64 22 Z" fill="#7a5a14" />
            {/* Beak */}
            <path
                d="M28 58 L52 50 L52 66 Z"
                fill="#6e3a14"
            />
            {/* Eye */}
            <circle cx="68" cy="48" r="5" fill="#1a1208" />
            <circle cx="69.5" cy="46.5" r="1.5" fill="#e8d59a" />
            {/* Wing */}
            <path
                d="M95 95 C115 85, 150 90, 160 110 C140 118, 110 115, 95 95 Z"
                fill="#6a4d10"
            />
        </svg>
    </div>
);
