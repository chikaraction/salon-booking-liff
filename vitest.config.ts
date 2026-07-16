import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    // 判断ロジックは src/lib/ に純粋関数で置き、テストを併置する(CLAUDE.md)
    include: ["src/lib/**/*.test.ts"],
    environment: "node",
  },
});
