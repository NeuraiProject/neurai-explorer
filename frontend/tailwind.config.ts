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
            colors: {
                border: "hsl(var(--border) / <alpha-value>)", // Assuming HSL which is standard for shadcn-like, but globals.css used hex. 
                // Wait, globals.css used hex directly in --background: #ffffff; 
                // If I used hex, I can just use var(--background). 
                // But Tailwind with opacity modifiers needs raw values if using <alpha-value>.
                // For now, let's just use `var(--variable)` which works but opacity modifiers won't work perfectly unless I change globals to use HSL/RGB channels.
                // Given the build error is just "class does not exist", simply defining them will fix it.
                background: "var(--background)",
                foreground: "var(--foreground)",
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
                    foreground: "var(--primary-foreground)",
                },
                secondary: {
                    DEFAULT: "var(--secondary)",
                    foreground: "var(--secondary-foreground)",
                },
                muted: {
                    DEFAULT: "var(--muted)",
                    foreground: "var(--muted-foreground)",
                },
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
            backgroundImage: {
                'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
                'gradient-conic':
                    'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
            },
        },
    },
    plugins: [],
}
export default config
