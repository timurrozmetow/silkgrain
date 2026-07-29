import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.tsx'],
  addons: ['@storybook/addon-essentials', '@storybook/addon-a11y'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  typescript: {
    // Props tables are generated from the TypeScript types and their doc comments.
    reactDocgen: 'react-docgen-typescript',
  },
  docs: { autodocs: 'tag' },
  // No anonymous usage reporting from this repository.
  core: { disableTelemetry: true },
};

export default config;
