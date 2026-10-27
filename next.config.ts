import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next 16.3 以降の next dev は、AIエージェントを検出するとリポジトリ直下に
  // AGENTS.md(同梱ドキュメントを読めという定型文)を自動生成する。
  // このリポジトリは CLAUDE.md に同じ趣旨のルール(実物で確認する)があるので無効にする
  // (node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/agentRules.md)
  agentRules: false,
  logging: {
    // 開発サーバーは既定で Server Action の呼び出しを引数ごとターミナルに出す。
    // login(メールアドレス, パスワード)が平文で残るため無効にする
    // (開発時のみの機能で本番ビルドには影響しない。
    //  node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/logging.md)
    serverFunctions: false,
  },
  // E2E(npm run test:e2e)の開発サーバーは、ふだんの npm run dev と同時に動かせるよう
  // ビルドの置き場を分ける(next dev は置き場にロックを取るため、同じ置き場だと2つ目が起動しない)。
  // 値は playwright.config.ts が渡す。通常の開発・本番ビルドでは未設定で既定の .next
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
};

export default nextConfig;
