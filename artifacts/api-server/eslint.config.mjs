import { createRequire } from "node:module";
import tsParser from "@typescript-eslint/parser";

const require = createRequire(import.meta.url);
const requireReturnRes = require("./eslint-rules/require-return-res.cjs");

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "generated-thumbnails/**",
      "public/**",
      "templates/**",
      "scripts/**",
      "verification/**",
      "docs/**",
      "build.mjs",
      "*.cjs",
      "*.mjs",
      "kb-smoke.bundle.mjs",
    ],
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      local: {
        rules: {
          "require-return-res": requireReturnRes,
        },
      },
      "@typescript-eslint": {
        rules: {
          "no-require-imports": { create: () => ({}), meta: { schema: [] } },
          "no-namespace": { create: () => ({}), meta: { schema: [] } },
          "no-unused-vars": { create: () => ({}), meta: { schema: [] } },
          "no-explicit-any": { create: () => ({}), meta: { schema: [] } },
          "ban-ts-comment": { create: () => ({}), meta: { schema: [] } },
          "no-unused-expressions": { create: () => ({}), meta: { schema: [] } },
          "no-empty-function": { create: () => ({}), meta: { schema: [] } },
          "no-non-null-assertion": { create: () => ({}), meta: { schema: [] } },
        },
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
    rules: {
      "local/require-return-res": "error",
    },
  },
];
