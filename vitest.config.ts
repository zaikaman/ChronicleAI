import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/**/src/**/*.test.ts", "packages/**/src/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["apps/**/src/**", "packages/**/src/**"],
      exclude: ["**/*.test.ts", "**/node_modules/**", "**/dist/**"],
    },
    passWithNoTests: true,
  },
});
