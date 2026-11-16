"use client";

// 管理画面のエラー境界。/admin にはレイアウトが無いので、この位置で
// /admin/login のページと (protected) のレイアウト・配下のページの両方の例外を受ける
// (error.js は同じ階層の layout は包まないが、配下のレイアウトは包む)。

import { ErrorScreen } from "@/components/error-screen";

export default function AdminError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return (
    <ErrorScreen
      error={error}
      retry={retry}
      titleParts={["データを", "読み込めませんでした"]}
      message="データベースに接続できない可能性があります。時間をおいて再読み込みしてください。続くときは、予約の受付を LINE のトークか電話に切り替えてください。"
    />
  );
}
