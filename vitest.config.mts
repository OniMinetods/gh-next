import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => ({
  resolve: {
    alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) }
  },
  test: {
    environment: "node",
    include: [
      mode === "integration"
        ? "tests/integration/**/*.test.ts"
        : "tests/unit/**/*.test.ts"
    ]
  }
}));
