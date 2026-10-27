// 手元のSupabase(npx supabase start)の接続情報を読む(ADR-008)。
// E2Eはテストのたびにデータを作り直すので、手元以外のDBに向いていたら必ず止める。

import { execSync } from "node:child_process";

export type LocalSupabase = {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
};

/** `supabase status -o env` の出力(KEY="value" の行)を読む */
function parseEnvLines(output: string): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line.trim());
    if (match) entries[match[1]] = match[2];
  }
  return entries;
}

let cached: LocalSupabase | undefined;

export function readLocalSupabase(): LocalSupabase {
  if (cached) return cached;

  let output: string;
  try {
    output = execSync("npx supabase status -o env", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    throw new Error(
      "手元のSupabaseが動いていません。先に `npx supabase start` を実行してください",
    );
  }

  const env = parseEnvLines(output);
  const url = env.API_URL ?? "";
  const host = url ? new URL(url).hostname : "";
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(
      `E2Eの接続先が手元のSupabaseではありません: ${url || "(なし)"}`,
    );
  }
  if (!env.ANON_KEY || !env.SERVICE_ROLE_KEY) {
    throw new Error("supabase status からキーを読めませんでした");
  }

  cached = {
    url,
    anonKey: env.ANON_KEY,
    serviceRoleKey: env.SERVICE_ROLE_KEY,
  };
  return cached;
}
