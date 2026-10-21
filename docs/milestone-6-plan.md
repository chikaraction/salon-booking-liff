# Milestone 6: Cloudflare へのデプロイ(OpenNext)

- 日付: 2026-10-20
- 参照ADR: ADR-001(Cloudflare Workers / 無料〜月数百円)/ ADR-002(Webhook・Cron Triggers は M5)/
  ADR-003(LIFF・LINEログイン)/ ADR-005(/admin のアクセス制御)/ ADR-007(1デプロイ=1店舗、
  環境ごとの値は環境変数、2店舗目の手順をREADMEに)
- 前提: M1〜M4c は main にマージ済み。M5(LINE通知)より先に M6 をやる
  (M5 の Webhook・前日リマインドは公開HTTPSと Cron Triggers が前提のため)。
  M2・M3・M4c で「M6デプロイ後」に回した LIFF 実機確認をここで消化する

## スコープ

1. **Next.js を 16.2.10 → 16.4.2 に上げる**(下記「事前調査」1。OpenNext 最新版の必須条件)
2. **OpenNext(`@opennextjs/cloudflare`)で Cloudflare Workers に載せる構成を追加**
   (`wrangler.jsonc` / `open-next.config.ts` / npm scripts / `.gitignore`)
3. **`src/proxy.ts` を Edge ランタイムの `src/middleware.ts` に戻す**(下記「決めたいこと」1)
4. **LIFF のエントリーページ**: `/`(create-next-app のテンプレートのまま)を、
   `liff.init()` を呼んで `/booking`・`/my` へ振り分けるページに置き換える(下記「事前調査」6)
5. **デプロイ前の環境変数チェック**(本番ビルドに `NEXT_PUBLIC_LIFF_STUB` が入らない・
   必須の値が空でない)を純粋関数+テストで用意し、ビルドコマンドの前段で実行する
6. **ユーザー作業の手順書**(Cloudflare・LINE Developers・LINE公式アカウント)をこの文書に書き、
   ユーザーが実施 → デプロイ → `verify-booking` の「(M6デプロイ後)」項目をまとめて消化
7. **README の「2店舗目の追加」を実際の手順で書き直す**(ADR-007)
8. **M5 への申し送り**(Webhook URL・Messaging API チャネル・Cron Triggers の足場)を整理

### スコープ外

- Webhook の受け口・前日リマインドの Cron 処理・プッシュ送信(M5)。M6 では
  Cron Triggers を**設定しない**(カスタムワーカーの入口だけ M5 に申し送る)
- 独自ドメイン(`workers.dev` のサブドメインで運用開始。下記「決めたいこと」4)
- PR ごとの自動テスト(CI)— 見送り決定済み。下記の Workers Builds は**デプロイの仕組み**で、
  テストは走らせない
- 画面の変更(`/` 以外)。LINEプッシュは増えない(ADR-002 の無料枠に影響なし)

## 事前調査の結果(実物で確認したこと / 推測を区別)

調べ方: `@opennextjs/cloudflare@1.20.12` と `next@16.4.2` をスクラッチ領域にインストールし、
同梱のソース・テンプレート・Next のドキュメント(`node_modules/next/dist/docs`)を読んだ。
加えて OpenNext・Cloudflare・LINE の公式ドキュメント、OpenNext の GitHub Issue を参照。

### 1. Next のバージョン — **16.2.10 のままでは最新の OpenNext が入らない**(確認済み)

`@opennextjs/cloudflare` の `peerDependencies.next` はセキュリティ修正版に合わせて下限が上がっている:

| OpenNext                  | 要求する next |
| ------------------------- | ------------- |
| 1.20.0(2026-06)           | `>=16.2.6`    |
| 1.20.2(2026-07)           | `>=16.2.11`   |
| 1.20.5(2026-08)           | `>=16.3.3`    |
| 1.20.12(2026-10-15、最新) | `>=16.4.1`    |

16.2 系は 16.2.12 で止まっている。古い OpenNext に合わせて Next を据え置くより、
**next / eslint-config-next を 16.4.2(latest)に上げる**。React 19.2.4 は 16.4.2 の
peer(`^19.0.0`)を満たすので据え置く。wrangler 4.x は Node 22 以上が必要(開発機は Node 24)。

### 2. `src/proxy.ts`(middleware の後継)— **OpenNext では「実験的・自己責任」**(確認済み)

- Next 16 の `proxy.ts` は **Node.js ランタイム固定**で、`runtime` 指定はエラーになる
  (`next/dist/docs/.../file-conventions/proxy.md`「Runtime」、`get-page-static-info.js`)
- OpenNext は Node ミドルウェアを 1.20.3 から扱えるが、ビルド時に
  「Node.js middleware support is experimental in cloudflare, and not officially maintained by
  OpenNext maintainers. Use at your own risk.」と警告する(`dist/cli/build/build.js`)。
  Next が内部で出力したミドルウェアを再バンドルする仕組みで、Next のバージョンごとに壊れうる
  と明記されている(`bundle-node-middleware.js` の冒頭コメント)。未解決の不具合報告もある
  (opennextjs-cloudflare #1400・#1401)
- Next の 16 移行ガイドは「Edge ランタイムを使い続けたいなら `middleware` を使い続けること」
  と明記(`docs/01-app/02-guides/upgrading/version-16.md`「middleware to proxy」)。
  `middleware.ts` は非推奨の警告が出るだけで動く
- OpenNext の既定設定はミドルウェアを `cloudflare-edge` ラッパーで動かす前提
  (`dist/api/config.js` の `middleware.override`)

→ 対応は「決めたいこと」1。

### 3. `next/font/google`(Noto Sans JP)— 問題なし(確認済み+一部推測)

ビルド時に Google Fonts から取得し `_next/static/media` に自己ホストされる。OpenNext は
`next build` の出力の静的ファイルを Workers の静的アセットとして配信するだけなので特別な対応は
不要。**ビルドする環境から fonts.googleapis.com に出られること**だけが条件(Workers Builds は
通常のネットワークがある想定 — 初回ビルドで確認する)。

### 4. ルートレイアウトの `connection()` による全ページ動的化 — 問題なし。ただしCPU時間に注意

- 全ページがリクエストごとに Worker で SSR される。ISR・SSG を使わないので、OpenNext の
  テンプレートが勧める R2 のキャッシュ(R2 バケット・自己参照サービスバインディング)は**使わない**。
  `defineCloudflareConfig()` の既定は `incrementalCache: "dummy"`(`dist/api/config.js`)
- `revalidatePath`(設定画面の Server Action)は dummy のタグキャッシュでは何もしないが、
  全ページ動的なので画面の再描画で最新値が出るはず(推測 → デプロイ後に確認)
- **Workers 無料プランは 1リクエストあたり CPU 10ms**(I/O 待ちは含まない。たまの超過は許容され、
  恒常的に超えると Error 1102)。React の SSR が 10ms に収まるかは**測るまで分からない**(下記「リスク」1)
- Worker のサイズ上限は現在 **無料・有料とも非圧縮 64 MiB**(Cloudflare の limits ページ。
  OpenNext のドキュメントにある「無料 3 MiB」は古い)

### 5. Server Actions / `@supabase/ssr` / `server-only` — 問題なし(確認済み+一部推測)

- Server Actions は OpenNext の対応機能(App Router)。LIFF も管理画面も同一オリジンなので
  `serverActions.allowedOrigins` は不要
- `@supabase/ssr` の Cookie 更新はもともと Edge ミドルウェア向けの設計で、`src/proxy.ts` の
  中身(`NextRequest` / `NextResponse` / `createServerClient`)はランタイム非依存。
  `@supabase/realtime-js` は `ws` パッケージを import していない(グローバル WebSocket)
- `server-only` は Next のビルドで解決される(OpenNext は Next の出力を包むだけ)
- 実行時の環境変数: OpenNext は Workers の変数・シークレットを `process.env` に流し込む
  (`dist/cli/templates/init.js` の `populateProcessEnv`)ので、`process.env.X` のコードはそのまま動く

### 6. LIFF の URL 遷移 — **`/` で `liff.init()` が必要**(LINE 公式ドキュメントで確認)

`https://liff.line.me/{LIFF ID}/my` を開くと、まず**エンドポイントURL**(例 `https://…/`)が
`liff.state` クエリ付きで開かれ、そのページで `liff.init()` を実行すると `/my` へ2次リダイレクト
される。いまの `/` はテンプレートのままで `liff.init()` を呼ばないので、**リッチメニューから
`/my` に行けない**。エンドポイントURLをサイトのルートにし、`/` を LIFF の入口にする
(スコープ4)。エンドポイントを `/booking` にすると `/my` が `/booking/my` になってしまう。

### 7. Windows での OpenNext ビルド — **保証外**(OpenNext ドキュメント)・ローカルビルドは秘密が焼き込まれる(確認済み)

- OpenNext は「Windows full support is not guaranteed」。この開発機は Windows で、WSL の
  ディストリビューションも入っていない
- **ローカルでビルドすると `.env.local` の値が Worker に埋め込まれる**。OpenNext は
  `.env` / `.env.production` / `.env.local` / `.env.production.local` を読んで
  `.open-next/cloudflare/next-env.mjs` に書き出し、実行時の `process.env` の既定値にする
  (`dist/cli/utils/extract-project-env-vars.js`・`compile-env-files.js`)。
  つまり開発機からデプロイすると `SUPABASE_SERVICE_ROLE_KEY` がスクリプト本体に入り、
  `NEXT_PUBLIC_LIFF_STUB=1` もクライアントに焼き込まれる(サーバーは本番でスタブを必ず拒否する
  ので乗っ取りにはならないが、全員が「認証エラー」になる)

→ 対応は「決めたいこと」2。

### 8. タイムゾーン — 対策済み(確認済み)

Workers は UTC で動く。日付ロジックは JST を明示する作り(`availability.ts` の `+09:00`、
`closures.ts` の祝日判定のコメント)で、`TZ=UTC npx vitest run` でも 647 件すべて通った。
Server Component・Server Action 側の表示はデプロイ後のスモークテストで確認する。

## 決めたいこと(ユーザーと擦り合わせ)

1. **ミドルウェア: `src/middleware.ts`(Edge)に戻すを推奨**
   - 中身は `src/proxy.ts` と同じ(関数名を `middleware` に戻すだけ)。ビルドで
     「middleware は非推奨」の警告が出るのは許容し、ファイル冒頭に理由と出典を書く
   - Edge で動いたことは `.next/server/middleware-manifest.json` に `"/"` のエントリがある
     (= OpenNext が Node ミドルウェア扱いしない)ことで確認する
   - 代替案: `proxy.ts` のまま OpenNext の実験的サポートに乗る。管理画面のログイン判定
     (ADR-005)が「保守対象外」の経路に乗るので却下を推奨。OpenNext が Node ミドルウェアを
     正式対応したら `proxy.ts` に戻す(README に申し送り)
2. **ビルドとデプロイ: Cloudflare の Workers Builds(GitHub 連携)を推奨**
   - Cloudflare 側の Linux でビルドするので Windows 非対応の問題を避けられ、リポジトリに
     `.env*` は無い(gitignore 済み)ので**秘密やスタブ設定が焼き込まれない**
   - `main` への push(= PR のマージ)で本番にデプロイされる。ビルド時の値
     (`NEXT_PUBLIC_*`)は「Build variables」、実行時の値は Worker の「Variables and Secrets」に置く
   - 2店舗目は「同じリポジトリを2店舗目の Cloudflare アカウントに連携して値を入れる」だけになり、
     ADR-007 の「2店舗目はデプロイ作業」に合う
   - 代替案: 開発機で `opennextjs-cloudflare build && deploy`。Windows で動く保証がなく、
     `.env.local` の秘密が Worker に入るので本番デプロイには使わない。**ローカルの
     `opennextjs-cloudflare preview`(workerd での動作確認)は、Windows で動けば開発用に使う**
3. **Cloudflare のプラン: まず Workers 無料プランで始め、CPU 時間を測ってから判断を推奨**
   - 恒常的に 10ms を超えて 1102 エラーが出るなら Workers Paid(月 $5 ≈ 750円)が必要。
     ADR-001 の「無料〜月数百円」を少し超えるので、その場合は**新ADRを起案して相談**する
4. **URL: `workers.dev` のサブドメインで始めるを推奨**(独自ドメインは後から足せる)
   - リッチメニューのリンクは `https://liff.line.me/{LIFF ID}/…` なので、後でドメインを変えても
     変えるのは LIFF のエンドポイントURLだけ
5. **LIFF のスコープ: `openid` に加えて `chat_message.write` も最初から付けるを推奨**
   - ADR-002 の「予約確認は無料の応答枠を優先」を M5 で `liff.sendMessages()`(客の発言として
     送り、Webhook の応答で返す)で実現する場合に必要。後から足すと客に同意画面が出直す。
     M5 で使わない方針になったら外す
6. **2店舗目の Cloudflare: 店舗ごとに別アカウントを推奨**(無料枠の 10万リクエスト/日・
   Cron 5個はアカウント単位。店ごとに持ち主を分けられる)。同じアカウントに Worker 名を変えて
   置く方法もある

## すり合わせ済みの決定(2026-10-21)

- 「決めたいこと」1〜6 はすべて推奨案で決定
- **既存の公式アカウント**: 一斉配信などに使っているが、Messaging API はおそらく無効。
  リッチメニューも無い
- **開発中は、ユーザーが新たに作るテスト用の公式アカウントで確認する**。そのうえで次の形にする:
  - LINE の userId はプロバイダー単位なので、**本番で使うつもりのプロバイダーを今つくり**、
    テスト用公式アカウント・LINE ログインチャネル・LIFF をすべてそこに置く
  - 本番切り替え(遅くとも M5)では、店の既存の公式アカウントで Messaging API を有効化するときに
    **このプロバイダーを選ぶ**(変更不可)。LIFF・LINEログインチャネルはそのまま使えるので
    **再ビルド不要**。変えるのは店の公式アカウントにリッチメニューを作ることだけ
  - テスト用公式アカウントに入れたテスト予約・顧客は、本番前に E で削除する
  - プロバイダーの管理者は作った人(ユーザー)の LINE アカウントになる。オーナーも管理者に
    追加しておくと、引き継ぎで困らない
  - 既存の公式アカウントで Messaging API を有効化したときの一斉配信・チャット・自動応答への
    影響は、Webhook を使う M5 で確認する(M6 では既存アカウントに触らない)
- **Cloudflare アカウントは無い** → 手順 A-1 で新規作成(無料プラン)。サブドメイン名は作成時に決める

## 環境変数・シークレットの一覧と置き場所

`.env.example` を正とし、置き場所を追記する。**値はすべてユーザーが Cloudflare の画面に入力する**
(Claude は認証情報を扱わない)。

| 変数                            | 種類                         | 置き場所(Workers Builds の場合) | 本番の値                                                            |
| ------------------------------- | ---------------------------- | ------------------------------- | ------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | 公開・**ビルド時に埋め込み** | Build variables                 | Supabase の Project URL                                             |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 公開・ビルド時               | Build variables                 | anon キー                                                           |
| `NEXT_PUBLIC_LIFF_ID`           | 公開・ビルド時               | Build variables                 | LIFF ID(LIFF作成後に入れて再ビルド)                                 |
| `NEXT_PUBLIC_LIFF_STUB`         | 公開・ビルド時               | **設定しない**                  | 空(デプロイ前チェックで1なら失敗させる)                             |
| `SUPABASE_SERVICE_ROLE_KEY`     | **秘密**・実行時             | Variables and Secrets(Secret)   | service_role キー                                                   |
| `LINE_LOGIN_CHANNEL_ID`         | 実行時                       | Variables and Secrets(Text)     | LINEログインチャネルのチャネルID                                    |
| `LINE_CHANNEL_SECRET`           | 秘密・実行時                 | (M5 で追加)                     | Messaging API のチャネルシークレット(Webhook署名検証)               |
| `LINE_CHANNEL_ACCESS_TOKEN`     | 秘密・実行時                 | (M5 で追加)                     | Messaging API の長期アクセストークン                                |
| `LINE_CHANNEL_ID`               | —                            | —                               | コードで未使用。M5 で要否を決める(不要なら `.env.example` から削除) |

- `NEXT_PUBLIC_*` は `next build` 時にクライアント・サーバー両方のコードへ文字列として埋め込まれる
  ので、**変えたら再ビルドが必要**。実行時の変数だけ変えても効かない
- `.env.example` に「本番では Cloudflare のどこに置くか」を注記する
- ローカル開発は従来どおり `.env.local`(OpenNext のドキュメントも `next dev` では `.env` を推奨)

## デプロイ前チェック(新しい純粋ロジック・テストファースト)

`src/lib/deploy-env.ts` — 本番ビルドに使う環境変数の集合を受け取り、問題の一覧を返す。

- `NEXT_PUBLIC_LIFF_STUB` が空以外 → エラー(「本番ビルドでスタブを有効にしてはいけません」)
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` が空 → エラー
- `NEXT_PUBLIC_LIFF_ID` が空 → **警告**(初回デプロイは LIFF 作成前なので止めない。客側は
  「LINEから開いてください」相当の表示になる)
- 秘密(`SUPABASE_SERVICE_ROLE_KEY`)はビルド時には無いのが正しいのでチェックしない

配線は `scripts/check-deploy-env.*` から `process.env` を渡して呼び、エラーがあれば終了コード1。
Workers Builds のビルドコマンドを `npm run build:cloudflare`(チェック → `opennextjs-cloudflare build`)
にする。スクリプトから `src/lib` の TS を読む方法(Node 24 の型除去、または `tsx`)は実装時に
実物で決める。

## LIFF のエントリーページ(`/`)

- `src/lib/liff-entry.ts`(純粋関数・テストファースト): URL のクエリを受け取り、
  `liff.state` があれば「LIFF SDK の2次リダイレクトに任せる(何もしない)」、無ければ
  「`/booking` へ」を返す。スタブモードでは常に `/booking`
- `src/app/page.tsx` はクライアント側で `liff.init()`(`src/liff/client.ts` の初期化を共用)→
  上の判定どおり `router.replace`。見た目は読み込み中の表示だけ(テンプレートの画像・文言・
  `next/image` は削除)
- `liff.init()` が `liff.state` のリダイレクトをいつ行うか(Promise 解決の前か後か)は SDK の
  実装で確認し、実機で `/my` に着くことを確かめる

## 追加・変更するファイル(予定)

- `package.json`: next・eslint-config-next を 16.4.2 に。`@opennextjs/cloudflare`・`wrangler` を
  devDependencies に。scripts に `build:cloudflare` / `preview:cloudflare`
- `wrangler.jsonc`: `main: .open-next/worker.js`、`assets`、`compatibility_flags:
["nodejs_compat", "global_fetch_strictly_public"]`、`compatibility_date`。
  R2・`WORKER_SELF_REFERENCE`・`images` はテンプレートから外す(使わない)。`name` は店名を
  含まない汎用名(ADR-007)
- `open-next.config.ts`: `defineCloudflareConfig()`(既定の dummy キャッシュ)
- `.gitignore`: `.open-next/`・`.wrangler/`・`.dev.vars*`。ESLint の対象からも `.open-next` を外す
- `src/proxy.ts` → `src/middleware.ts`(決めたいこと1)
- `src/app/page.tsx`、`src/lib/liff-entry.ts`(+テスト)、`src/lib/deploy-env.ts`(+テスト)、
  `scripts/check-deploy-env.*`
- `.env.example`(置き場所の注記)、`README.md`(デプロイ・2店舗目)、
  `.claude/skills/verify-booking/SKILL.md`(M6 の項目)

## ユーザーにしかできない作業の手順

Claude はアカウント作成・ログイン・認証情報の入力をしない。以下はユーザーが行い、
画面に出た値(URL・ID)のうち**秘密でないものだけ**チャットで教えてもらう。

### A. Cloudflare(初回デプロイ)

1. Cloudflare アカウントを作成(または既存にログイン)。Workers & Pages を開き、
   `workers.dev` のサブドメインを決める
2. Workers & Pages → 作成 → **Git リポジトリをインポート** → GitHub で
   `chikaraction/salon-booking-liff` へのアクセスを Cloudflare の GitHub アプリに許可
3. ビルド設定: ビルドコマンド `npm run build:cloudflare`、デプロイコマンド
   `npx opennextjs-cloudflare deploy`、本番ブランチ `main`(具体の項目名は実装時に画面と
   OpenNext のドキュメントで確定させて追記する)
4. **Build variables** に `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` を入れる
   (`NEXT_PUBLIC_LIFF_ID` は C の後で)
5. Worker の **Variables and Secrets** に `SUPABASE_SERVICE_ROLE_KEY`(Secret)を入れる
   (`LINE_LOGIN_CHANNEL_ID` は B の後で)
6. M6 のブランチを main にマージ → 自動でビルド・デプロイ。ビルドログと
   `https://<worker>.<subdomain>.workers.dev/admin` が開くことを確認
   (初回だけ、マージ前に feature ブランチのプレビュー版で確認する方法も実装時に検討)

### B. LINE Developers: プロバイダーと LINE ログインチャネル

1. LINE Developers コンソールで**本番用のプロバイダー**を作成(名前は店名など。
   「すり合わせ済みの決定」のとおり、店の公式アカウントも後でここに入れる)
2. そのプロバイダーに **LINE ログインチャネル**を作成(アプリタイプ: ウェブアプリ)
3. チャネル基本設定の**チャネルID**を控える → Cloudflare の `LINE_LOGIN_CHANNEL_ID` に入れる
4. 客に使わせる前にチャネルを**公開**(Published)にする。作成直後は開発中(Developing)で、
   管理者・テスターしか LINE ログインできない(LINE Developers のドキュメントで確認済み)。
   テスト用公式アカウントでの確認は開発中のままでよい

### C. LIFF アプリの作成

1. B のチャネルの「LIFF」タブ → 追加
   - サイズ: **Full** / エンドポイントURL: `https://<worker>.<subdomain>.workers.dev/`(**末尾はルート**)
   - スコープ: `openid`(+決めたいこと5 の `chat_message.write`)
   - 友だち追加オプション: Off(既存客は友だち登録済み)/ Scan QR・モジュールモード: Off
   - 注: LINE は新規 LIFF を「LINE ミニアプリ」として作ることを推奨しているが、ADR-003 は LIFF。
     コンソールで通常の LIFF が作れない場合は実装を止めて相談する
2. 表示された **LIFF ID** を控える → Cloudflare の Build variables `NEXT_PUBLIC_LIFF_ID` に入れて再ビルド
   (Workers Builds の「再デプロイ」)

### D. テスト用の LINE 公式アカウントとリッチメニュー

1. LINE Official Account Manager でテスト用の公式アカウントを新規作成し、自分の LINE で友だち追加
   (M6 では Messaging API の有効化は不要。M5 で有効化するときは B-1 のプロバイダーを選ぶ)
2. リッチメニュー → 作成
3. ボタン「予約する」→ リンク `https://liff.line.me/<LIFF ID>/booking`、
   「マイ予約」→ `https://liff.line.me/<LIFF ID>/my`(画像・レイアウトは自由。店名等はここで)
4. 表示期間を設定して公開(本番切り替え時に、店の公式アカウントにも同じものを作る)

### E. 本番データの準備(リモートDBへの書き込みなのでユーザー作業)

1. 開発で入れたテスト用の予約・顧客(スタブの `U-dev-user-1` 等)・Auth ユーザーを削除
   (Claude が確認用と削除用の SQL を用意する。`verify-booking` の「本番の顧客データを入れる前」)
2. 管理画面から店名・営業時間・スタッフ・メニュー・表示設定を本番の値にする

## M5 への申し送り

- **Messaging API チャネル**: 開発中はテスト用公式アカウント、本番は店の既存の公式アカウントで
  Messaging API を有効化したもの。**どちらも LIFF と同じプロバイダー(上記 B-1)を選ぶ**。
  違うプロバイダーにすると、LIFF で溜まった `customers.line_user_id` にプッシュできない
- **Webhook URL**: `https://<worker>.<subdomain>.workers.dev/api/line/webhook`(パスは M5 で確定)。
  LINE Developers の Messaging API 設定で「Webhook の利用」をオン、公式アカウント側の
  応答設定(応答メッセージ・チャット)との兼ね合いは M5 で決める
- **シークレット**: `LINE_CHANNEL_SECRET`(署名検証)・`LINE_CHANNEL_ACCESS_TOKEN` を Worker の
  Secret に追加
- **Cron Triggers**: OpenNext が生成するワーカーは `fetch` しか export しない。前日リマインドには
  `.open-next/worker.js` を import して `scheduled` を足したカスタムワーカーを作り、
  `wrangler.jsonc` の `main` をそれに向け、`triggers.crons` を足す(OpenNext の
  「Custom Worker」ドキュメント)。Cron は **UTC** 指定(JST の時刻から9時間引く)。
  無料プランは Cron Triggers 5個/アカウント
- **Supabase の一時停止対策**: 前日リマインドが毎日 DB を読むので、ADR-001 の「1週間アクセスが
  ないと一時停止」の対策にもなる
- **LIFF スコープ**: 決めたいこと5 の `chat_message.write` を付けていれば `liff.sendMessages()` が使える

## リスク

1. **無料プランの CPU 10ms**: 測るまで分からない。デプロイ後に Workers のメトリクス
   (CPU 時間の分布・エラー)を確認し、超えるなら決めたいこと3 のとおり新ADRで相談
2. **Next 16.4 への更新による挙動差**: マイナー更新だが、テスト・ビルド・主要画面の
   スモークテストを先に通してから OpenNext に進む(更新だけで1コミット)
3. **Workers Builds の細部**(Node のバージョン、ビルドコマンドの項目名、プレビュー版)は
   画面と最新ドキュメントで実装時に確定する(この文書の該当箇所は推測を含む)
4. OpenNext の Windows 非対応: ローカルの `preview` が動かなければ、動作確認は
   デプロイ後の実環境だけで行う

## 実施順序

1. **Next 16.4.2 への更新**(サブエージェント)— `npm test`・`npm run build`・
   `npm run dev` での主要画面スモーク → コミット
2. **ミドルウェアを Edge に戻す**(サブエージェント)— `middleware.ts` に改名、manifest で
   Edge を確認、未ログインで /admin → /admin/login のリダイレクトをスモーク → コミット
3. **デプロイ前チェック**(サブエージェント・テストファースト)→ コミット
4. **LIFF エントリーページ**(サブエージェント・テストファースト)→ コミット
5. **OpenNext の構成**(サブエージェント)— `wrangler.jsonc` 等を追加、Windows で
   `opennextjs-cloudflare build` → `preview` を試す(秘密がローカルの出力に入るのは
   ローカル限定なので可)。Worker のサイズを `wrangler deploy --dry-run` で確認 → コミット
6. **文書**(メイン)— README のデプロイ・2店舗目、`.env.example`、verify-booking の M6 項目 → コミット
7. **PR 作成**(依頼があれば)→ ユーザー作業 A → マージで初回デプロイ → B〜D → 再ビルド
8. **実機確認**(ユーザー+メイン)— 下記「検証方法」→ 結果を verify-booking に反映 → E

## 検証方法

ローカル(実装中):

- `npm test`(`deploy-env`・`liff-entry` を含む)・`npm run build`・`npm run lint`
- `npm run dev` で `/`(スタブ時に `/booking` へ)・`/booking`・`/my`・`/admin` のスモーク
- (Windows で動けば)`opennextjs-cloudflare preview` で同じスモーク

デプロイ後(`verify-booking` に「M6 デプロイ後」節を作ってまとめる):

- 既存の「(M6デプロイ後)」項目: リッチメニュー「マイ予約」から /my が直接開く /
  LINE内ブラウザでテーマ・フォントが反映される
- 「LIFF・LINEログイン」節の3項目(ログイン操作なしで本人特定・2回目は入力スキップ・
  自分の予約だけ見える)。この節に「M6デプロイ後」と明記する
- 「レスポンシブ」: 客側の全画面が LINE内ブラウザで崩れない
- 新規(M6):
  - 本番で `stub:` のIDトークンを Server Action に送ると拒否される / クライアントの
    バンドルに `NEXT_PUBLIC_LIFF_STUB` の値 `1` が無い / service_role キーが無い
  - 未ログインで本番の `/admin` 配下 → ログイン画面。ログインして1時間以上たっても
    (アクセストークン期限後も)ミドルウェアのトークン更新で使い続けられる
  - 設定画面の変更が再読み込みで反映される(`revalidatePath` と dummy キャッシュ)。
    表示設定の変更がリビルドなしで客側に効く(`connection()`)
  - 日付・時刻の表示が JST(Workers は UTC)。今日の予約・空き枠・締切判定
  - ダブルブッキング防止(ADR-004)の同時確定を本番URLで1回
  - Workers のメトリクスで CPU 時間とエラー(1102)を確認(リスク1)

## 実装の結果(2026-10-21)

実施順序 1〜5 はサブエージェントが1ステップ1コミットで実装し、メインでレビュー・
ブラウザのスモークテスト(スタブの dev で `/`→`/booking`、未ログインの `/admin/dashboard`→
`/admin/login`、`/my`)を行った。test 669件・build・lint が通っている。

確認できた事実(推測だった箇所の答え):

- **Next 16.4.2**: 16.3/16.4 で必須の移行作業はなし。`logging.serverFunctions` は有効なまま。
  **16.3 以降の `next dev` は AI エージェントを検出すると `AGENTS.md` を自動生成する**ので、
  `next.config.ts` に `agentRules: false` を追加した(`next-config-js/agentRules.md`)
- **middleware.ts は runtime を書かなければ Edge**(`next/dist/build/entries.js`)。
  ビルド後の `middleware-manifest.json` の `middleware["/"]` に Edge のエントリがあり、
  OpenNext の Node ミドルウェア警告は出ない。16.4 のドキュメントでは Edge Runtime 自体も
  deprecated 扱いになったが、`runtime` を書かない middleware.ts では警告は出ない
- **`liff.init()` と `liff.state`**(`@line/liff` 2.29.1 の `@liff/init`): 遷移先が今の URL と
  違えば `location.replace()` のあと解決しない Promise を待つ。つまり init 後の
  `router.replace` は SDK が遷移しなかったときだけ動き、二重遷移は起きない。
  LIFF ID 未設定・init 失敗時は SDK が遷移しないので `/booking` へ送る(`initFailed`。
  設計に追加)
- **デプロイ前チェック**は `scripts/check-deploy-env.mjs` から Node のネイティブ型除去で
  `src/lib/deploy-env.ts` を読む。Workers Builds の既定 Node は 24.18.0 で、`.node-version`
  (24.18.0)で固定した(Cloudflare の build-image ドキュメント)
- **`wrangler.jsonc` に `keep_vars: true`**: 既定の `wrangler deploy` は画面で設定した Text 変数
  (`LINE_LOGIN_CHANNEL_ID`)をデプロイのたびに消すため(設計に追加)
- `compatibility_date` は `2026-10-19`(インストールした workerd 1.20261019.1 の対応日付)
- **Windows でも `opennextjs-cloudflare build` と `preview` は動いた**(「Windows 非完全対応」の
  警告は出る)。preview(workerd)で `/`・`/booking`・`/my`・`/admin/login` が 200、`/admin` 配下は
  `/admin/login` へ 307、フォントの woff2 も配信され、Supabase にも接続できた。dummy キャッシュで
  警告・エラーなし。ただし本番デプロイは方針どおり Workers Builds(秘密が焼き込まれないため)
- **Worker のサイズ**: `wrangler deploy --dry-run` で 7,359 KiB(gzip 1,552 KiB)。上限 64 MiB に
  余裕がある
- テンプレートの `public/*.svg`(未使用)を削除した

残課題(M6 の範囲では対応しない):

- `_next/static/*` が `Cache-Control: max-age=0, must-revalidate` で配信される(preview で確認)。
  長期キャッシュには `public/_headers` が要りそうだが未確認。CPU 時間には影響しない
  (静的アセットは Worker を起動しない)ので、表示速度が気になったら対応する
- Workers Builds の main 以外のブランチのビルドのコマンド(OpenNext で使えるか)は未確認。
  使わない想定
- npm の allow-scripts で esbuild・workerd の postinstall はブロックされたまま(プラットフォーム別
  バイナリで動いた)。Workers Builds の Linux でも動くかは初回ビルドで確認する

## デプロイと実機確認の結果(2026-10-21)

- PR #6 マージ → Workers Builds で初回デプロイ。URL は
  `https://<worker-name>.<subdomain>.workers.dev`
- **初回は `/admin/login`・`/booking` が 500**。ミドルウェア(anon キー)は動き、service_role で
  DB を読む画面だけが落ちていた。手元で本番と同じ条件(`.env` なし、変数は外から渡す)で
  ビルドすると正常だったので、コード・構成ではなく画面に入れた値を疑い、シークレット
  `SUPABASE_SERVICE_ROLE_KEY` を**ローテートで貼り直したら直った**(最初の値が不正だった)
- エラーの中身が見られなかったので、PR #7 で Workers Logs(`observability`)を常時有効にした
- **LIFF ID が効かなかった**: Build variables に入れたあと、変数を足した版(再ビルドなし)が
  動いていた。Next はビルド時に値がある `NEXT_PUBLIC_*` だけを文字列に置き換えるので、
  `env.NEXT_PUBLIC_LIFF_ID` を読む形のまま残っていた。ビルドの**再試行**で埋め込まれた
- Cloudflare の画面・AI は `wrangler.jsonc` の `vars` に `LINE_LOGIN_CHANNEL_ID` を書くよう勧めるが、
  `keep_vars: true` で画面の値が残るので不要。コードに書くと2店舗目で1店舗目の値が使われる(ADR-007)
- **LINE 実機(テスト用公式アカウント)の確認は OK**: リッチメニューから `/booking`・`/my`、
  本人特定、2回目の入力スキップ、自分の予約だけ表示、テーマ・フォント
- 実機での指摘: 画面下のボタンが端末の角の丸みと重なる・下端との余白が欲しい →
  `viewport-fit=cover` が無く `env(safe-area-inset-bottom)` が 0 だった。下部余白を
  「基本 + セーフエリア」にする修正を別 PR で行う

残り(M6 の範囲):

- Workers のメトリクスで CPU 時間と 1102 エラーを、しばらく運用してから確認する(リスク1)
- 本番運用の前に、テスト用に入れた予約・顧客・Auth ユーザーを削除する(手順 E。SQL を用意する)
- 本番切り替え(店の公式アカウントで Messaging API を有効化するとき同じプロバイダーを選ぶ・
  リッチメニュー作成・ログインチャネルを公開)は M5 と合わせて行う
