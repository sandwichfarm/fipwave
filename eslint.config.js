export default [
  {
    ignores: [
      '.artifacts/**',
      '.planning/**',
      'dist/**',
      'node_modules/**',
    ],
  },
  {
    // TypeScript source is checked by strict `tsc`; this audited dependency set
    // deliberately does not include a TypeScript ESLint parser.
    files: ['**/*.{js,mjs,cjs}'],
    rules: {},
  },
];
