import tseslint from 'typescript-eslint'

// Thresholds at today's measure: a ratchet, lowered after each cleanup, never raised.
export default tseslint.config(
  {
    files: ['hooks/**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: { complexity: ['error', 6], 'max-lines': ['error', { max: 461 }] },
  },
  {
    files: ['hooks/register.tsx'],
    rules: { complexity: ['error', 109], 'max-lines': ['error', { max: 1234 }] },
  },
)
