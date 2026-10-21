# salon-booking-liff

美容室の来店予約システム。客側はLINE公式アカウント経由のLIFFアプリ、店側はWeb管理画面(`/admin`)。

設計判断は [docs/adr/](docs/adr/) を参照(スタック: ADR-001、ダブルブッキング防止: ADR-004)。

## スタック

- Next.js(App Router)+ TypeScript + Tailwind CSS v4 + shadcn/ui
- Supabase(PostgreSQL + Auth)
- ホスティング: Cloudflare Workers(OpenNext アダプタ `@opennextjs/cloudflare`。ビルドとデプロイは
  Cloudflare の Workers Builds が GitHub から行う。経緯: `docs/milestone-6-plan.md`)

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
npm run check:deploy-env    # デプロイ前チェックだけ(process.env を見る。.env.local は読まない)
npm run build:cloudflare    # デプロイ前チェック → OpenNext でWorker用にビルド(Workers Builds 用)
npm run preview:cloudflare  # ビルドしてローカルの workerd で動かす(開発用。チェックなし)
```

## デプロイ(Cloudflare Workers)

本番のビルドとデプロイは **Cloudflare の Workers Builds** が GitHub の `main` から行う
(`main` へのマージ = 本番デプロイ)。開発機からはデプロイしない。理由:

- OpenNext はローカルでビルドすると `.env.local` の値(service_role キー・
  `NEXT_PUBLIC_LIFF_STUB=1`)を Worker に埋め込む。Workers Builds はリポジトリだけで
  ビルドするので、`.env*`(gitignore 済み)が入らない
- OpenNext は Windows での動作を保証していない

`npm run preview:cloudflare` は手元で Worker として動かす確認用(http://localhost:8790 前後)。
この開発機(Windows)では動いたが、OpenNext は Windows を保証していない。`.env.local` の値が
`.open-next/` に埋め込まれるので、`.open-next/` は共有・コミットしない(gitignore 済み)。
ローカルで `npm run check:deploy-env` を実行するとエラーになるのが正常(`.env.local` を
読まないため、必須の値が空と判定される)。

### 環境変数の置き場所

`.env.example` に一覧がある。本番の値は Cloudflare の画面にだけ入れる。

| 変数                                                                                 | 置き場所                                           | 備考                                         |
| ------------------------------------------------------------------------------------ | -------------------------------------------------- | -------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `NEXT_PUBLIC_LIFF_ID` | Settings → Build → **Build variables and secrets** | ビルド時に埋め込まれる。**変えたら再ビルド** |
| `NEXT_PUBLIC_LIFF_STUB`                                                              | **設定しない**                                     | 設定するとデプロイ前チェックでビルドが止まる |
| `SUPABASE_SERVICE_ROLE_KEY`                                                          | Settings → **Variables and Secrets**(Secret)       | 実行時に読む                                 |
| `LINE_LOGIN_CHANNEL_ID`                                                              | Settings → **Variables and Secrets**(Text)         | 実行時に読む                                 |

Build variables は実行時には見えない(Cloudflare の仕様)。実行時の値は Variables and
Secrets 側に入れる。

### 初回デプロイの手順

アカウント作成・ログイン・値の入力は、その店舗の担当者(開発者)が行う。

**1. Cloudflare**

1. Cloudflare アカウントを作成(無料プラン)。Workers & Pages を開き、`workers.dev` の
   サブドメインを決める
2. Workers & Pages → **Create application** → **GitHub** → このリポジトリを選ぶ
   (Cloudflare の GitHub アプリにリポジトリへのアクセスを許可する)
3. ビルド設定
   - Worker 名: `salon-booking-liff`(`wrangler.jsonc` の `name` と同じにする。違うとビルドが失敗する)
   - Build command: `npm run build:cloudflare`
   - Deploy command: `npx opennextjs-cloudflare deploy`
   - Git branch: `main`
   - Node.js: リポジトリ直下の `.node-version`(24.18.0)が使われる
   - 実行時の変数は `wrangler.jsonc` の `keep_vars: true` により、デプロイのたびに消えない
     (Deploy command に `--keep-vars` を付ける必要はない)
   - main 以外のブランチのビルド(プレビュー)は使わない想定。OpenNext でのプレビュー用
     コマンドは未確認なので、設定にあれば無効にしておく
4. Build variables に `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`、
   Variables and Secrets に `SUPABASE_SERVICE_ROLE_KEY` を入れる
   (`NEXT_PUBLIC_LIFF_ID` と `LINE_LOGIN_CHANNEL_ID` は LINE の設定後)
5. デプロイが成功したら `https://<Worker名>.<サブドメイン>.workers.dev/admin` が開くことを確認

**2. LINE Developers**

LINE の userId は**プロバイダー単位**。LIFF(LINE ログインチャネル)と、通知を送る
Messaging API チャネル(公式アカウント)は**必ず同じプロバイダー**に置く。違うと、LIFF で
登録された客にプッシュを送れない。公式アカウントのプロバイダーは後から変えられない。

1. 店舗用のプロバイダーを作成(オーナーも管理者に追加しておく)
2. そのプロバイダーに **LINE ログインチャネル**を作成(アプリタイプ: ウェブアプリ)。
   チャネルIDを Cloudflare の `LINE_LOGIN_CHANNEL_ID` に入れる
3. 客に使わせる前にチャネルを**公開**(Published)にする。作成直後は開発中(Developing)で、
   チャネルの管理者・テスターしか LINE ログインできない(動作確認はこの状態で行える)
4. チャネルの LIFF タブで LIFF アプリを追加
   - サイズ: Full
   - エンドポイントURL: `https://<Worker名>.<サブドメイン>.workers.dev/`(**サイトのルート**。
     `/` が LIFF の入口で、`https://liff.line.me/<LIFF ID>/my` は `/my` に振り分けられる)
   - スコープ: `openid`、`chat_message.write`
   - 友だち追加オプション: Off
5. LIFF ID を Cloudflare の Build variables `NEXT_PUBLIC_LIFF_ID` に入れて**再ビルド**
   (Deployments から再実行、または `main` に push)

**3. LINE 公式アカウント**

1. 公式アカウントの Messaging API を有効にするときは、手順2-1 のプロバイダーを選ぶ
2. リッチメニューを作成し、ボタンのリンクを次にする
   - 予約する: `https://liff.line.me/<LIFF ID>/booking`
   - マイ予約: `https://liff.line.me/<LIFF ID>/my`

**4. データベースと店舗の設定**

- `npx supabase link --project-ref <project-ref>` → `npx supabase db push`
- 管理画面のログインアカウントは「管理画面にログインさせる」の手順で作る
- 管理画面から店名・営業時間・定休日・スタッフ・メニュー・予約ポリシー・表示設定を入れる

デプロイ後の確認は `verify-booking` スキルの「M6 デプロイ後」節を使う。

### 本番でエラーが出たとき

- エラーの中身は Worker の **Observability**(Workers Logs)で見る。`wrangler.jsonc` の
  `observability` で常時有効にしてある(無料プランは1日20万件・保持3日)
- 画面が「A server error occurred」になり、`/admin` のリダイレクトだけは効く場合は、
  実行時のシークレット(`SUPABASE_SERVICE_ROLE_KEY`)の値を疑う。初回デプロイでは、貼り付けた
  値が不正で全画面が 500 になり、**ローテートで貼り直したら直った**(末尾の改行・空白や
  別のキーが混ざっていないか)

## 2店舗目の追加(ADR-007)

マルチテナントにはせず、店舗ごとに1セットを用意する。**コードの変更は要らない**
(同じリポジトリを2つ目の Cloudflare に連携するだけ)。

| 店舗ごとに用意するもの | 備考                                                                         |
| ---------------------- | ---------------------------------------------------------------------------- |
| Supabase プロジェクト  | 新規作成 → `npx supabase link` → `npx supabase db push`                      |
| Cloudflare アカウント  | 店舗ごとに別アカウント(無料枠の 10万リクエスト/日・Cron 5個はアカウント単位) |
| LINE プロバイダー      | ログインチャネル+LIFF+Messaging API(公式アカウント)を同じプロバイダーに      |
| LINE 公式アカウント    | 店の既存アカウントを使う                                                     |

手順は上の「初回デプロイの手順」1〜4 をそのまま新しい店舗の値で行う。Worker 名は
`wrangler.jsonc` の `name` と同じでよい(アカウントが違えば URL は
`<Worker名>.<その店のサブドメイン>.workers.dev` で別になる)。

同じ Cloudflare アカウントに2店舗目を置く場合は Worker 名を変える必要があり、
`wrangler.jsonc` の `name` と食い違うので、別アカウントを推奨する。
