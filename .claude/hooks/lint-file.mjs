#!/usr/bin/env node
// PostToolUse hook: Claudeがファイルを編集するたびに、そのファイル単体に
// prettier --write と eslint --fix を適用する。
// - 対象: .ts / .tsx / .js / .jsx のみ(それ以外は即終了)
// - 自動修正できないlintエラーが残った場合は exit 2 で
//   stderr の内容がClaudeにフィードバックされ、Claudeが修正に取りかかる。
// - Windows/macOS/Linuxで動くようにシェルスクリプトではなくNodeで実装。

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

// stdinからフック入力(JSON)を受け取る
let raw = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) raw += chunk;

let filePath = "";
try {
  const data = JSON.parse(raw);
  filePath = data?.tool_input?.file_path ?? "";
} catch {
  process.exit(0); // 入力が読めなければ何もしない(編集自体は妨げない)
}

// 対象外は即終了(フックは同期実行なので軽さが最優先)
if (!filePath || !/\.(ts|tsx|js|jsx)$/.test(filePath)) process.exit(0);
if (/node_modules|[\\/]\.next[\\/]/.test(filePath)) process.exit(0);
if (!existsSync(filePath)) process.exit(0);

const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();

function run(args) {
  try {
    execFileSync("npx", args, { cwd, stdio: "pipe", shell: true });
    return null;
  } catch (e) {
    return `${e.stdout?.toString() ?? ""}${e.stderr?.toString() ?? ""}`;
  }
}

// 整形(失敗しても続行)
run(["prettier", "--write", filePath]);

// lint自動修正。修正しきれないエラーが残ったらClaudeに差し戻す
const eslintOut = run(["eslint", "--fix", filePath]);
if (eslintOut && eslintOut.trim()) {
  console.error(
    `自動修正できないlintエラーが残っています。修正してください:\n${eslintOut.trim()}`,
  );
  process.exit(2); // exit 2 のみがブロック+フィードバックとして扱われる
}
process.exit(0);
