import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/core/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/core/main.ts", "src/core/exchange.ts"],
      reporter: ["text", "json-summary"],
    },
  },
});
