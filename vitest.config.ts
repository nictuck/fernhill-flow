import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// UI tests opt into jsdom with `// @vitest-environment jsdom` at the top of the file.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["tests/helpers/setup.ts"],
    testTimeout: 10_000,
  },
});
