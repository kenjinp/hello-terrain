import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
/**
 * Shared layout configurations
 *
 * you can customise layouts individually from:
 * Home Layout: app/(home)/layout.tsx
 * Docs Layout: app/docs/layout.tsx
 */
export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <>
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
            aria-label="Terrain Logo"
            role="img"
          >
            {/* Speech bubble */}
            <path
              d="M4 4c0-1.1.9-2 2-2h12c1.1 0 2 .9 2 2v10c0 1.1-.9 2-2 2H8.83L5.59 20.17A1 1 0 0 1 4 19.41V4z"
              fill="#6dd1ed"
              opacity="0.85"
            />

            <polygon
              points="8.5,12 12,7 15.5,12 14,10.5 12,12.5 10,10.5"
              fill="#059669"
              stroke="#059669"
              strokeWidth="0.7"
              strokeLinejoin="round"
            />
          </svg>
          Hello Terrain
        </>
      ),
    },
    // githubUrl: "https://github.com/kenjinp/hello-terrain",
    // see https://fumadocs.dev/docs/ui/navigation/links
    links: [],
  };
}
