import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/",
        "tests/",
        "*.config.*",
        ".next/",
        "coverage/",
        "app/",
        "components/",
        "lib/db/",
        "server/routers/",
        "scripts/",
      ],
      include: ["server/services/**/*.ts"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
  // Override PostCSS config to avoid Tailwind v4 plugin conflicts
  css: {
    postcss: {
      plugins: [],
    },
  },
});
