import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["node_modules/", "coverage/", "types/", "test/fixtures/", "mods/*/gpui-kit.d.ts"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-console": "error",
      eqeqeq: ["error", "always"],
    },
  },
  {
    // The code that ships also gets the rules that need types. node:test's test() and describe() return a
    // promise that the runner settles, so the test files are left out of them.
    files: ["mods/cc-accounts/*.js", "scripts/*.mjs"],
    languageOptions: {
      parserOptions: { project: ["./tsconfig.json", "./tsconfig.mod.json"], tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { arguments: false } }],
    },
  },
  {
    // The CLI's entry point has no extension.
    files: ["mods/cc-accounts/cc-accounts"],
    languageOptions: { globals: globals.node },
  },
  {
    // The mod runs in Herdr, not in Node: its host provides localStorage and no Node globals.
    files: ["mods/cc-accounts/main.js", "mods/cc-accounts/model.js"],
    languageOptions: { globals: { localStorage: "readonly" } },
  },
  prettier,
);
