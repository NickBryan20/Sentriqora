import aegisflowConfig from './packages/config-eslint/base.mjs';

export default [
  ...aegisflowConfig,
  {
    ignores: [
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/dist/**',
      '**/node_modules/**',
      '**/generated/**',
    ],
  },
];
