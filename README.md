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
npm run db:types   # DBの型(src/types/database.types.ts)を再生成する
```

`npm run db:types` はリンク済みのDBのスキーマを読み取るだけで、Dockerは要らない
(`npx supabase login` 済みであること)。生成ファイルは手で直さずにコミットする。

マイグレーションの事前の検証は、手元のSupabase(Docker。準備は「テスト」の節)で
`npx supabase db reset --local` して行う。マイグレーション+seed(開発用ダミーデータ)が
入り直る。`--local` を付けて、リンク済みのリモートのDBには触れないこと。

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
> 予約・顧客のデータも見えない(予約系のRLSと店側RPCも `current_staff_role()` で
> 判定する)。ログインはできるが、予約カレンダーは空になり代行登録もできない。

### スタッフがやめたとき

1. 管理画面のスタッフ設定で、そのスタッフを**無効**にする(過去の予約が参照して
   いるので削除はしない)。無効にした時点で、そのスタッフのログインは予約・顧客・
   設定のどのデータにも触れなくなる(`current_staff_role()` が無効スタッフに NULL を返す)
2. 管理画面を使っていた人なら、Supabaseダッシュボードの **Authentication → Users** で
   その auth ユーザーも**削除**する。ログインそのものを止め、使われないアカウントを残さない

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

## テスト

### ユニットテスト

`src/lib/` の純粋ロジック(予約枠の計算・営業時間の判定・通知の文面など)のテスト(Vitest)。

```sh
npm test               # すべて流す
npm run test:watch     # 変更のたびに流す
npm run test:coverage  # カバレッジも計測する(結果は coverage/index.html)
```

### E2E(Playwright。ADR-008)

ブラウザで実際の画面を操作して確かめるテスト。客側の予約の流れ・ダブルブッキング・
管理画面のアクセス制御・設定の反映・スマホ幅の崩れなどを、Chromium / WebKit / Firefox で流す。

準備(初回だけ):

1. WSL2 と Docker Desktop を入れる(手元のSupabaseを動かすため)
2. Playwright のブラウザを取得する

```sh
npx playwright install
```

流すとき:

```sh
npx supabase start   # 手元のSupabaseを起動する(Docker Desktop を先に起動しておく)
npm run test:e2e     # 全テストを流す(5分ほど)
npx playwright show-report   # 結果を見る
```

- テストのたびに手元のDBを作り直してから流す(`supabase db reset --local`)。
  つなぐのは手元のSupabaseだけで、`.env.local` のリモートのDB・本物のLINEの値は使わない
- 開発サーバーはテスト用に別のポート(3100)で自動で起動する。`npm run dev` と同時に動かしてよい
- `show-report` では、通ったテストも含めて、テストごとに最後の画面とトレース
  (操作ごとの画面・通信・コンソールのログ)が見られる。トレースは「View Trace」で開く
- 一部のテストだけ流すとき: `npx playwright test e2e/customer --project=chromium`
- iPhone の Safari でだけ起きる崩れは E2E では確かめられない(テスト用の WebKit は Windows 版)。
  実機での確認は verify-booking のチェックリスト(`.claude/skills/verify-booking/SKILL.md`)

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
| `LINE_CHANNEL_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN`                                  | Settings → **Variables and Secrets**(Secret)       | Messaging API(通知)。実行時に読む            |
| `CRON_SECRET`                                                                        | Settings → **Variables and Secrets**(Secret)       | 前日リマインドの Cron の入口を守る           |

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
   - Node.js: リポジトリ直下の `.node-version`(24.22.1)が使われる
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

**3. LINE 公式アカウント(通知: 予約確認の応答・前日リマインド)**

1. LINE Official Account Manager → 設定 → Messaging API → 有効化。プロバイダーは
   **手順2-1 のもの**を選ぶ(変更不可)
2. LINE Developers に出来た Messaging API チャネルで、チャネルシークレット(チャネル基本設定)と
   長期のチャネルアクセストークン(Messaging API設定)を発行し、Cloudflare の Variables and
   Secrets に `LINE_CHANNEL_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN`(Secret)として入れる。
   あわせて `CRON_SECRET`(Secret。ランダムな長い文字列。生成例は `.env.example`)も入れる。
   実行時の値なので再ビルドは要らない
3. Messaging API設定の Webhook URL に `https://<Worker名>.<サブドメイン>.workers.dev/api/line/webhook`
   を入れて「検証」→「Webhookの利用」をオン
4. OA Manager の応答設定: **チャット オン・Webhook オン・応答メッセージ オフ**
   (応答メッセージがオンだと、予約確認の定型文に自動応答も二重に返る。店のふだんのチャットは
   そのまま使える。Webhook は定型文にしか応答しない)
5. リッチメニューを作成し、ボタンのリンクを次にする
   - 予約する: `https://liff.line.me/<LIFF ID>/booking`
   - マイ予約: `https://liff.line.me/<LIFF ID>/my`

前日リマインドは Cron Triggers(`wrangler.jsonc` の `triggers.crons`、毎時0分)で動き、
送信時刻は管理画面の店舗設定で変えられる(既定 18:00)。Cron はデプロイで自動的に登録される。

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
- 前日リマインドが届かず、ログに「Cron(0 * * * *)の前日リマインドが失敗しました: HTTP 500」が
  出る場合は、`CRON_SECRET` が Worker から見えていない。`/api/cron/reminders` に Bearer なしで
  POST して 500 なら確定(正常なら 401)。一覧に名前があっても値が空のことがあるので、
  **値を入れ直す**(M5 の確認で実際に起きた。入れ直しは再ビルド不要で、すぐ効く)
- 前日リマインドの結果は Workers Logs に「前日リマインド: …」で残る(Cron の実行は Worker の
  画面の Cron の実行履歴でも見られるはず。画面の項目名は未確認)。Webhook の失敗は「LINE Webhook の処理に失敗しました」
  「予約確認の応答に失敗しました」

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
