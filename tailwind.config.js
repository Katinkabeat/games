import sqPreset from './packages/sq-ui/tailwind-preset.js';

/** @type {import('tailwindcss').Config} */
export default {
  presets: [sqPreset],
  content: [
    './index.html',
    './src/**/*.{js,jsx}',
    './packages/sq-ui/**/*.{js,jsx}',
  ],
};
