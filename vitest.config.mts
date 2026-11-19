import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: { "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Test files share one database, so run them one at a time.
    fileParallelism: false,
    setupFiles: ["tests/setup.ts"],
    globalSetup: ["tests/global-setup.ts"],
  },
});
