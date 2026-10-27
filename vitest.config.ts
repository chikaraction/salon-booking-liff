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
    // npm run test:coverage で計測する(通常の npm test では計測しない)。
    // 対象はユニットテストの守備範囲である src/lib/ の本体だけ
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/**/*.test.ts"],
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "coverage",
    },
  },
});
