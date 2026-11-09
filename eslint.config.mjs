// Root ESLint config for TypeScript in services/* and packages/*. apps/web has its own
// Next.js config and is linted by its package script. Kept syntax-only (no type-aware
// rules) so it never needs a tsconfig per file and stays fast in CI.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      ".*/**",
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/.vercel/**",
      "**/coverage/**",
      "apps/web/**",
      "apps/video/**",
      "deliverables/**",
      "infra/blender/**",
      "packages/contracts/**",
      ".claude/**",
      "**/*.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.mts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": ["error", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },
  {
    // CLIs and scripts print to the terminal by design.
    files: ["**/scripts/**", "**/bin/**", "**/cli.ts", "**/*.test.ts", "**/test/**"],
    rules: { "no-console": "off" },
  },
  {
    files: ["**/*.mjs", "**/*.js", "**/*.cjs"],
    languageOptions: { globals: globals.node },
  },
  {
    // Film capture scripts drive Playwright; callbacks passed to page.evaluate and
    // addInitScript run inside the browser page, so both global sets apply.
    files: ["film/capture/**/*.mjs"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
