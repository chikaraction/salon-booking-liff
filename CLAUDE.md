# salon-booking

美容室の予約システム。客側はLINE公式アカウント経由のLIFFアプリ、店側はWeb管理画面(/admin)。

## 最重要ルール

- 設計判断はすべて `docs/adr/` に従う。実装前に関連ADRを読むこと
- ADRと矛盾する実装が必要になったら、実装せずまず相談すること
- 画面は `docs/mockups/` のスクリーンショットを正とする。モックに無い部分の共通の
  決まり(ボタンの並びなど)は `docs/ui-guidelines.md`
- 新しいマイルストーン/機能の実装は `milestone` スキルのワークフローに従う。
  マージ前の実機確認は `verify-booking` スキルのチェックリストを使う

## スタック

Next.js(App Router) / Supabase(PostgreSQL + Auth) / Cloudflare / Tailwind + shadcn/ui
詳細と選定理由: ADR-001、ADR-006

## コマンド

```sh
npm run dev      # 開発サーバー
npm run build    # 本番ビルド + 型チェック
npm test         # ユニットテスト(src/lib/ の純粋ロジック、Vitest)
npm run lint     # Lint(ESLint)
npm run format   # Prettierで全体整形
npm run db:types # DBの型を再生成(リンク済みのリモートDBを読み取る)
```

スキーマ変更: `supabase/migrations/` にマイグレーションを追加し
`npx supabase db push` で適用(ローカルにDockerはない。制約の実機検証は
verify-booking スキル、SQLの事前検証はPGliteが使える)。適用したら
`npm run db:types` で `src/types/database.types.ts` を再生成してコミットする
(生成ファイルは手で直さない)。null を受け付ける引数を持つRPCを足したら
`src/types/database.ts` の上書きにも足す。コードは `@/types/database` の
`Database` / `DbClient` を使う。

## 設計規約

- 判断ロジック(予約枠計算・営業時間判定・通知文生成など)は `src/lib/` に
  純粋関数で置き、テストを併置する。DOM・Supabaseクライアントのimport禁止。
  新規ロジックはテストファースト、既存変更は特性化テストで挙動固定が先
- UIコンポーネントとServer Actionは配線に徹する。判断が現れたらlib/へ押し戻す
- ダブルブッキング防止の本体はDBのEXCLUDE制約(ADR-004)。アプリ側チェックは
  UX向上のための補助であり、制約を外す・迂回する変更は禁止
- スキーマ変更は必ずマイグレーションファイルで行う(ダッシュボード直編集禁止)
- 店舗固有の値(店名・メニュー・料金・営業時間)をコードに書かない(ADR-007)
- パーミッション・API識別子・ライブラリの挙動は推測せず実物で確認する

## 言語

コメント・コミットメッセージ・UI文字列・テストのdescribe/itは日本語。
