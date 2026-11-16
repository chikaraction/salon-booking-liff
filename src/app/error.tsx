"use client";

// 全体の既定のエラー境界(客側の /booking などで、サーバー側の例外が起きたとき)。
// ルートレイアウト自体の例外はここでは受けられないので global-error.tsx が受ける。
// 管理画面(/admin 配下)は src/app/admin/error.tsx が先に受ける。

import { ErrorScreen } from "@/components/error-screen";

export default function RootError({
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
      titleParts={["予約画面を", "開けませんでした"]}
      message="時間をおいて、もう一度お試しください。お急ぎの場合は、LINE のトークでお店にご連絡ください。"
    />
  );
}
