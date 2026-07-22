import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import importPlugin from 'eslint-plugin-import';
import tailwindcssPlugin from 'eslint-plugin-tailwindcss';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/out/**',
      '**/public/**',
      '**/lib/db/migrations/**',
      '**/components/ui/**',
    ],
  },
  ...nextCoreWebVitals, // Next.js’s recommended rules
  {
    plugins: {
      import: importPlugin,
      tailwindcss: tailwindcssPlugin,
    },
    settings: {
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
        },
      },
    },
    rules: {
      ...(importPlugin.configs.recommended?.rules ?? {}),
      ...(importPlugin.configs.typescript?.rules ?? {}),
      ...(tailwindcssPlugin.configs.recommended?.rules ?? {}),
      'tailwindcss/no-custom-classname': 'off',
      'tailwindcss/classnames-order': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/static-components': 'off',
      'import/no-anonymous-default-export': 'off',
    },
  },
];
