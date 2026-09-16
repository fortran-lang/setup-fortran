import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'

export default tseslint.config(
    {
        ignores: ['dist/**', 'coverage/**', 'node_modules/**'],
    },
    {
        files: ['*.mjs', '*.cjs'],
        extends: [eslint.configs.recommended],
    },
    eslint.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,
    {
        files: ['src/**/*.ts'],
        extends: [
            eslint.configs.recommended,
            ...tseslint.configs.strictTypeChecked,
            ...tseslint.configs.stylisticTypeChecked,
        ],
        languageOptions: {
            globals: globals.node,
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            '@typescript-eslint/explicit-function-return-type': 'error',
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/no-explicit-any': 'error',

            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],

            'prefer-const': 'error',
            'no-var': 'error',

            '@typescript-eslint/consistent-type-imports': [
                'error',
                { prefer: 'type-imports' },
            ],

            '@typescript-eslint/only-throw-error': 'error',
            '@typescript-eslint/no-unnecessary-type-assertion': 'error',
            '@typescript-eslint/await-thenable': 'error',
            '@typescript-eslint/switch-exhaustiveness-check': 'error',
        },
    },
)
