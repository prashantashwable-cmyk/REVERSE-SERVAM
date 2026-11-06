import type { Config } from 'tailwindcss';

/** Design tokens (spec §23.1): deep navy, metallic silver, restrained gold. */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: { 50: '#eef2f8', 100: '#d5deeb', 600: '#1d3a63', 700: '#152d4f', 800: '#0f223d', 900: '#0b1a30' },
        silver: { 100: '#f3f5f8', 200: '#e3e7ed', 300: '#c9d0da', 500: '#8a94a3', 700: '#4b5563' },
        gold: { 400: '#c9a95c', 500: '#b38f3e', 600: '#8f7130' },
        ok: { 50: '#ecfdf3', 700: '#067647' },
        warn: { 50: '#fffaeb', 700: '#b54708' },
        crit: { 50: '#fef3f2', 700: '#b42318' },
      },
      fontFamily: {
        sans: ['Inter', 'DM Sans', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
