// 本番ビルド前の環境変数チェック(配線のみ。判定は src/lib/deploy-env.ts)。
// npm run build:cloudflare の前段で実行する。エラーがあれば終了コード1でビルドを止め、
// 警告は表示だけして続行する。
//
// src/lib/deploy-env.ts は Node のネイティブ型除去で直接読み込む
// (Node 22.18 / 23.6 以降は既定で有効。必要な Node のバージョンは .node-version で固定)。

import { checkDeployEnv } from "../src/lib/deploy-env.ts";

const issues = checkDeployEnv(process.env);

for (const issue of issues) {
  const label = issue.level === "error" ? "エラー" : "警告";
  console.error(`[デプロイ前チェック] ${label}: ${issue.message}`);
}

if (issues.some((issue) => issue.level === "error")) {
  console.error("[デプロイ前チェック] 失敗しました。ビルドを中止します");
  process.exit(1);
}

console.log("[デプロイ前チェック] OK");
