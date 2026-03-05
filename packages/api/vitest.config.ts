import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    minWorkers: 1,
    maxWorkers: 4,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
      thresholds: {
        lines: 88,
        statements: 88,
        branches: 80,
        functions: 90,
      },
    },
  },
});
