#!/usr/bin/env node
// PostToolUse hook: Claudeがファイルを編集するたびに、そのファイル単体に
// prettier --write と eslint --fix を適用する。
// - 対象: .ts / .tsx / .js / .jsx のみ(それ以外は即終了)
// - 自動修正できないlintエラーが残った場合は exit 2 で
//   stderr の内容がClaudeにフィードバックされ、Claudeが修正に取りかかる。
// - Windows/macOS/Linuxで動くようにシェルスクリプトではなくNodeで実装。

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

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

// プロジェクトの外のファイルには手を出さない
const target = path.resolve(cwd, filePath);
const relative = path.relative(cwd, target);
if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
  process.exit(0);
}

// シェルを通さずに node で直接起動する。
// ファイル名はフックの入力(= 信頼できない値)なので、シェルに渡すと
// 「a&コマンド&.ts」のような名前でコマンドを実行されてしまう。
// 「--」の後ろに置き、「-」で始まる名前がオプションとして読まれるのも防ぐ。
function run(bin, args) {
  const script = path.join(cwd, "node_modules", bin);
  if (!existsSync(script)) return null; // npm ci 前などは何もしない
  try {
    execFileSync(process.execPath, [script, ...args, "--", target], {
      cwd,
      stdio: "pipe",
    });
    return null;
  } catch (e) {
    return `${e.stdout?.toString() ?? ""}${e.stderr?.toString() ?? ""}`;
  }
}

// 整形(失敗しても続行)
run("prettier/bin/prettier.cjs", ["--write"]);

// lint自動修正。修正しきれないエラーが残ったらClaudeに差し戻す
const eslintOut = run("eslint/bin/eslint.js", ["--fix"]);
if (eslintOut && eslintOut.trim()) {
  console.error(
    `自動修正できないlintエラーが残っています。修正してください:\n${eslintOut.trim()}`,
  );
  process.exit(2); // exit 2 のみがブロック+フィードバックとして扱われる
}
process.exit(0);
