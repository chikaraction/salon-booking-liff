#!/usr/bin/env node
// PreToolUse hook: メインセッションからの src/ 配下への Edit/Write をブロックし、
// 実装をサブエージェントへ委譲することを強制する(milestoneスキルの分担指針)。
// - サブエージェント内の呼び出し(フック入力に agent_id がある)は許可
// - src/ 以外(docs/ supabase/ .claude/ など)はメインセッションでも許可
//   (設計・スキーマ変更・レビューはメイン担当のため)

// stdinからフック入力(JSON)を受け取る
let raw = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) raw += chunk;

let input;
try {
  input = JSON.parse(raw);
} catch {
  process.exit(0); // 入力が読めなければ何もしない(編集自体は妨げない)
}

// agent_id はサブエージェント内でのみ存在する
const isSubagent = typeof input?.agent_id === "string" && input.agent_id !== "";
if (isSubagent) process.exit(0);

const filePath = String(input?.tool_input?.file_path ?? "");
if (!filePath) process.exit(0);

// プロジェクト直下の src/ 配下かどうかを判定(絶対・相対どちらの指定にも対応)
const projectDir = (process.env.CLAUDE_PROJECT_DIR || process.cwd()).replace(/[\\/]+$/, "");
const normalized = filePath.replaceAll("\\", "/");
const projectPrefix = `${projectDir.replaceAll("\\", "/")}/src/`;
const isUnderSrc =
  normalized.toLowerCase().startsWith(projectPrefix.toLowerCase()) ||
  normalized.startsWith("src/");

if (!isUnderSrc) process.exit(0);

console.log(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        `メインセッションからの src/ への直接編集は禁止されています(実装はサブエージェントに委譲するルール)。` +
        `Agentツールでサブエージェントを起動し、milestoneスキルの手順4〜7を指示に含めて委譲してください。対象: ${filePath}`,
    },
  }),
);
