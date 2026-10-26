import "server-only";

// PostgREST(@supabase/supabase-js)の結果を扱う共通の小道具(サーバー専用)。

/** PostgRESTの結果からデータを取り出す。エラーは例外にする(サーバー側の障害) */
export function must<T>(
  result: { data: T | null; error: { message: string } | null },
  subject: string,
): T {
  if (result.error !== null || result.data === null) {
    throw new Error(
      `${subject}の取得に失敗しました: ${result.error?.message ?? "データがありません"}`,
    );
  }
  return result.data;
}
