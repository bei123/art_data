import js from '@eslint/js'
import tsParser from '@typescript-eslint/parser'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'
import vueParser from 'vue-eslint-parser'

/** 前后端 JS + Vue；渐进加严，未使用变量先 warn 便于存量代码落地 */
export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'uploads/**',
      'ssl/**',
      '**/.cursor/**',
      'package-lock.json',
      // 本地草稿/片段脚本，不参与规范门禁
      'upgrade_image_upload.js',
    ],
  },

  // Node / Express（CommonJS）
  {
    files: ['**/*.js'],
    ignores: ['src/**'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          caughtErrors: 'none',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },

  // 管理端 Vue + ESM（essential：核心规则，避免 recommended 下大量格式类告警拖垮存量项目）
  ...pluginVue.configs['flat/essential'],
  {
    files: ['src/**/*.js'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      'vue/multi-word-component-names': 'off',
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          caughtErrors: 'none',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['src/**/*.vue'],
    languageOptions: {
      globals: globals.browser,
      parser: vueParser,
      parserOptions: {
        parser: tsParser,
        ecmaVersion: 'latest',
        sourceType: 'module',
        extraFileExtensions: ['.vue'],
      },
    },
    rules: {
      'vue/multi-word-component-names': 'off',
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          caughtErrors: 'none',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
]
