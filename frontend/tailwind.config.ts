import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './node_modules/@daveyplate/better-auth-ui/dist/**/*.{js,mjs}',
  ],
  theme: {
    fontFamily: {
      // font-display → Montserrat (headings, brand marks)
      display: ['var(--il-font-heading)', 'Montserrat', '"Avenir Next"', '"Segoe UI"', 'sans-serif'],
      // font-sans → Source Sans (body text)
      sans: ['var(--il-font-sans)', '"Source Sans 3"', '"Source Sans Pro"', 'Arial', 'sans-serif'],
      // font-mono → system monospace (code, logs)
      mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', '"Courier New"', 'monospace'],
    },
    extend: {
      borderRadius: {
        // Canonical radius tokens derived from --radius (0.5rem)
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      colors: {
        // ── Semantic tokens (HSL vars, support /opacity modifiers) ───────────
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
          accessible: 'hsl(var(--secondary-accessible))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
          accessible: 'hsl(var(--destructive-accessible))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        // Status / data-vis (HSL vars, support /opacity modifiers)
        'status-success': 'hsl(var(--status-success))',
        'status-info': 'hsl(var(--status-info))',
        'status-neutral': 'hsl(var(--status-neutral))',
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))',
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar-background))',
          foreground: 'hsl(var(--sidebar-foreground))',
          primary: 'hsl(var(--sidebar-primary))',
          'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
          accent: 'hsl(var(--sidebar-accent))',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
          hover: 'hsl(var(--sidebar-hover))',
          'hover-foreground': 'hsl(var(--sidebar-hover-foreground))',
          border: 'hsl(var(--sidebar-border))',
          ring: 'hsl(var(--sidebar-ring))',
        },

        // ── Illinois brand palette (hex CSS vars from CDN illinois.css) ───────
        // ⚠  These are hex values and do NOT support Tailwind opacity modifiers.
        //    Use the semantic tokens above when /opacity is needed.
        // Fallback hex values guard against the CDN stylesheet failing to
        // load (see layout.tsx), so these colors stay valid even then.
        illinois: {
          // Primary
          orange: 'var(--il-orange, #FF5F05)',           // Illini Orange
          blue: 'var(--il-blue, #13294B)',               // Illini Blue
          // Accessible orange (higher contrast for small/body text)
          altgeld: 'var(--il-altgeld, #C84113)',
          // Storm grays
          storm: 'var(--il-storm, #707372)',
          'storm-60': 'var(--il-storm-60, #8E9090)',
          'storm-80': 'var(--il-storm-80, #C6C7C6)',
          white: 'var(--il-white, #FFFFFF)',
          black: 'var(--il-black, #000000)',
          // Supporting (charts, infographics only per brand guidelines)
          industrial: 'var(--il-industrial, #1D58A7)',
          arches: 'var(--il-arches, #009FD4)',
          patina: 'var(--il-patina, #007E8E)',
          berry: 'var(--il-berry, #5C0E41)',
          harvest: 'var(--il-harvest, #FCB316)',
          prairie: 'var(--il-prairie, #006230)',
          earth: 'var(--il-earth, #7D3E13)',
        },
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0) rotate(var(--tw-rotate))' },
          '50%': { transform: 'translateY(-20px) rotate(var(--tw-rotate))' },
        },
        gradient: {
          '0%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
          '100%': { backgroundPosition: '0% 50%' },
        },
      },
      animation: {
        float: 'float 6s ease-in-out infinite',
        gradient: 'gradient 6s ease infinite',
      },
      backgroundSize: {
        'gradient-size': '200% 200%',
      },
    },
  },
  plugins: [require('tailwindcss-animate'), require('@tailwindcss/typography')],
};
export default config;
