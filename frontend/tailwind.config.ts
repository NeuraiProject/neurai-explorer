import type { Config } from 'tailwindcss'

const config: Config = {
    darkMode: 'class',
    content: [
        './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
        './src/components/**/*.{js,ts,jsx,tsx,mdx}',
        './src/app/**/*.{js,ts,jsx,tsx,mdx}',
        './src/lib/**/*.{js,ts,jsx,tsx}',
    ],
    theme: {
        extend: {
            screens: {
                // Focus on Mobile -> Desktop (lg) transition as the standard
                'lg': '1024px',
            },
            fontSize: {
                // We can ensure our smallest "legal" size is 14px (0.875rem)
                // but it's better to just use the standard classes in JSX.
            },
            fontFamily: {
                sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
                mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
            },
            borderRadius: {
                card: 'var(--radius-card)',
                inner: 'var(--radius-inner)',
            },
            boxShadow: {
                card: 'var(--shadow-card)',
            },
            colors: {
                // All colours come from the CSS variables in globals.css so
                // that light/dark are one source of truth.
                background: "var(--background)",
                foreground: "var(--foreground)",
                border: "var(--border)",
                input: {
                    DEFAULT: "var(--input)",
                    border: "var(--input-border)",
                },
                card: {
                    DEFAULT: "var(--card)",
                    foreground: "var(--card-foreground)",
                },
                popover: {
                    DEFAULT: "var(--popover)",
                    foreground: "var(--popover-foreground)",
                },
                primary: {
                    DEFAULT: "var(--primary)",
                    hover: "var(--primary-hover)",
                    foreground: "var(--primary-foreground)",
                    soft: "var(--primary-soft)",
                    "soft-border": "var(--primary-soft-border)",
                },
                secondary: {
                    DEFAULT: "var(--secondary)",
                    foreground: "var(--secondary-foreground)",
                },
                muted: {
                    DEFAULT: "var(--muted)",
                    foreground: "var(--muted-foreground)",
                },
                subtle: "var(--subtle-foreground)",
                accent: {
                    DEFAULT: "var(--accent)",
                    foreground: "var(--accent-foreground)",
                },
                destructive: {
                    DEFAULT: "var(--destructive)",
                    foreground: "var(--destructive-foreground)",
                },
                link: "var(--link)",
                success: "var(--success)",
                warning: "var(--warning)",
                ring: "var(--ring)",
            },
        },
    },
    plugins: [],
}
export default config
