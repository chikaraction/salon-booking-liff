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

### スタッフの追加

スタッフの追加・編集は**管理画面の「スタッフ」設定**(`/admin/settings/staff`)から
行う。オーナーのみ操作できる(ADR-005)。

ここで作られるのは `staff` テーブルの行だけで、**管理画面のログインアカウントは
作られない**。追加したスタッフは次の状態になる:

- 客側の予約画面に指名候補として出る / 空き枠計算の対象になる(勤務パターンを
  設定した曜日のみ)
- **管理画面にはログインできない**

施術のみ担当し管理画面を使わないスタッフは、ここまでで完結する。

### 管理画面にログインさせる(必要な場合のみ)

管理画面(`/admin`)の認証は Supabase Auth のメール+パスワード。**招待制**で、
セルフサインアップは使わない(ADR-005)。ユーザー作成はSupabaseダッシュボードで
行い、上で作った `staff` 行と手動で紐付ける。**この作業はSupabaseプロジェクトに
アクセスできる担当者(通常は開発者)が行う。**

1. Supabaseダッシュボードの **Authentication → Providers** で
   「Allow new users to sign up」を**無効**にする(招待制の担保。初回のみ)
2. **Authentication → Users → Add user** でスタッフのメール+パスワードを作成
3. 作成した auth ユーザーのUUIDを、対応する `staff` 行に紐付ける(SQL Editorで実行。
   **この手順は必須**):

   ```sql
   update public.staff
   set auth_user_id = '<auth.users の id>'
   where name = '<スタッフ名>';   -- または対象の staff.id で指定
   ```

4. ロールを確認する(`role` は `'owner'` / `'staff'` のいずれか。既定は `'staff'`)。
   ロールは管理画面のスタッフ設定からも変更できる

> **手順3を飛ばすと設定変更が一切できない。** M4bでロール差が実効化したため、
> `staff.auth_user_id` が未紐付けのユーザーは DBの `current_staff_role()` が NULL に
> なり、オーナーであるはずでも設定系のRLSに弾かれる。管理画面でも設定グループが
> 表示されず、`/admin/settings/*` を開くと「オーナー権限が必要です」と表示される。
> 予約カレンダー・代行登録は紐付けなしでもログインさえできれば使える。

> **逆に、手順1〜4を行わなくてもスタッフの運用は始められる。** 予約の受付・空き枠
> 計算に必要なのは `staff` 行と勤務パターンだけで、ログインは管理画面を使う人に
> だけ必要。

### 権限(オーナー / スタッフ)

ADR-005 のとおり2ロール。アプリ層(サイドバーの出し分け・設定レイアウト・
Server Actionのオーナー判定)と RLS(設定系テーブルの書き込みをオーナーのみ)の
二重で担保する。

| 操作                                             | オーナー | スタッフ |
| ------------------------------------------------ | -------- | -------- |
| 予約の閲覧(カレンダー)                           | ✓        | ✓        |
| 代行登録・代行変更・代行キャンセル・スタッフメモ | ✓        | ✓        |
| 営業日・営業時間の設定                           | ✓        | ✗        |
| スタッフの追加・編集・勤務パターン               | ✓        | ✗        |
| メニュー・カテゴリの管理                         | ✓        | ✗        |
| 店舗・予約設定(店名・予約ポリシー)               | ✓        | ✗        |

設定系テーブル(`salon_settings` / `business_hours` / `staff` /
`staff_working_hours` / `menus` / `menu_categories` / `nth_weekday_closures` /
`date_overrides`)は**閲覧は全スタッフ可・変更はオーナーのみ**。
予約運用のテーブル(`reservations` / `reservation_menus` / `customers` /
`push_messages`)は従来どおり全スタッフが操作できる。

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
