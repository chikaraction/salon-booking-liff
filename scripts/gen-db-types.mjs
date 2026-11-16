// DBの型(src/types/database.types.ts)を、手元のSupabase(リポジトリの supabase/。
// npx supabase start で起動)のスキーマから作り直す。npm run db:types から呼ぶ。
//
// 「> ファイル」で書き出さないのは、Supabase CLI が失敗したときも標準出力にエラー内容
// (JSON)を出し、型のファイルがそれで上書きされるため(CLI 3.1.0、Docker 停止中に確認)。
// CLI の出力をいったん受け取り、成功したとき(終了コード0)だけ書き込む。
//
// CLI 3.x の gen types は既定で手元のDBを読む(--remote を付けたときだけリモート)。

import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const OUTPUT = "src/types/database.types.ts";

let types;
try {
  types = execSync("npx supabase gen types typescript --schema public", {
    encoding: "utf8",
    // 標準エラー(CLI の警告や接続先の表示)はそのまま画面に出す
    stdio: ["ignore", "pipe", "inherit"],
    maxBuffer: 64 * 1024 * 1024,
  });
} catch (error) {
  console.error(
    "[db:types] 型を作れませんでした。手元のSupabaseが起動しているか確かめてください(npx supabase start)。",
  );
  if (typeof error?.stdout === "string" && error.stdout !== "") {
    console.error(error.stdout);
  }
  console.error(`[db:types] ${OUTPUT} は変更していません`);
  process.exit(1);
}

writeFileSync(OUTPUT, types);
console.log(`[db:types] ${OUTPUT} を書き出しました`);
