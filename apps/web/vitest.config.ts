import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // The CRM store is a single-writer DuckDB file, so two test files opening
    // it in parallel workers fight over the same lock. Running files in series
    // matches how the app actually uses the store.
    fileParallelism: false,
    env: {
      // The CRM store defaults to /data, which is the Railway volume. Under
      // test that is either absent or, in CI, unwritable — and a suite that
      // tries to create it fails for a reason that has nothing to do with the
      // code. Pinned to a temp directory unless the caller says otherwise.
      CRM_DATA_DIR:
        process.env["CRM_DATA_DIR"] ?? path.join(os.tmpdir(), "jax-crm-test"),
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./src/test/server-only.ts", import.meta.url),
      ),
    },
  },
});
