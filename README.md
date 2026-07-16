# salon-booking-liff

美容室の来店予約システム。客側はLINE公式アカウント経由のLIFFアプリ、店側はWeb管理画面(`/admin`)。

設計判断は [docs/adr/](docs/adr/) を参照(スタック: ADR-001、ダブルブッキング防止: ADR-004)。

## スタック

- Next.js(App Router)+ TypeScript + Tailwind CSS v4 + shadcn/ui
- Supabase(PostgreSQL + Auth)
- ホスティング: Cloudflare(デプロイ構成は今後のマイルストーンで追加)

## セットアップ

```sh
npm install
cp .env.example .env.local   # 値はSupabase/LINE Developersから取得して設定
```

### データベース

スキーマ変更はすべて `supabase/migrations/` のマイグレーションファイルで行う
(ダッシュボード直編集は禁止)。

```sh
npx supabase link --project-ref <project-ref>
npx supabase db push
```

ローカルでDockerが使える環境なら `npx supabase db reset` で
マイグレーション+seed(開発用ダミーデータ)が投入できる。

## コマンド

```sh
npm run dev      # 開発サーバー
npm run build    # 本番ビルド + 型チェック
npm test         # ユニットテスト(src/lib/ の純粋ロジック)
npm run lint     # Lint
npm run format   # Prettierで全体整形
```

## 2店舗目の追加(ADR-007)

マルチテナントにはせず、店舗ごとに1セットをデプロイする。手順の骨子:

1. Supabaseプロジェクトを新規作成し、`npx supabase link` → `npx supabase db push`
2. LINE公式アカウント+Messaging APIチャネル+LIFFアプリを店舗用に作成
3. Cloudflareに新しいデプロイを作成し、環境変数(`.env.example` 参照)を設定
4. 管理画面から店名・メニュー・営業時間・スタッフを設定

(詳細な手順は初回デプロイのマイルストーンで確定させる)
