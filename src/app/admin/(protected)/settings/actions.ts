"use server";

// 設定系(営業日・スタッフ・メニュー・店舗設定)のServer Action。
// 実施順序5〜8で各設定の保存アクションがここに増える。
//
// 置き場所: 設定レイアウトと同じディレクトリに置き、設定系のアクションをまとめる
// (予約運用のアクションは src/app/admin/actions.ts のまま。権限の前提が違うため
//  ファイルを分ける。予約系はスタッフも実行できる: ADR-005)。
//
// 【後続タスクへ】設定系のアクションは必ず先頭で requireOwner()
// (@/server/admin-auth)を通すこと:
//
//   const guard = await requireOwner();
//   if (!guard.ok) return { ok: false, message: guard.message };
//
// requireOwner を "use server" のこのファイルではなく server-only の
// @/server/admin-auth に置いているのは、ここから export した関数がすべて
// クライアントから呼べるServer Actionエンドポイントになるため。
// ガードは呼び出し口を持つ必要がない。
//
// なぜアプリ層でも判定するか(RLSだけでは足りない理由):
// RLSのUPDATE/DELETEは、ポリシーに合致しない行を「存在しない行」として扱う。
// そのためスタッフが設定系テーブルをUPDATE/DELETEしてもエラーにはならず、
// 「0行更新」で静かに成功してしまう(INSERTだけは 42501 で失敗する)。
// アプリ層で先に弾かないと「保存できたように見えるのに何も変わっていない」
// というバグになる。RLSは迂回されたときの最後の砦、アプリ層はUXの防波堤。

export {};
