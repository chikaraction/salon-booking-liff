# Milestone 5: LINE通知(予約確認・前日リマインド)

- 日付: 2026-10-22
- 参照ADR: ADR-002(予約確認は無料の応答枠を優先・前日リマインドは1予約1通のプッシュ・
  キャンセル確認は画面で完結・150通超の警告)/ ADR-003(客の特定は LINE userId)/
  ADR-004(通知は予約の確定に影響しない)/ ADR-007(送信時刻などの店舗固有値をコードに書かない)
- 前提: M6 で Cloudflare Workers にデプロイ済み(`https://<worker-name>.<subdomain>.workers.dev`)。
  LIFF・LINEログインチャネル・テスト用公式アカウントは本番用プロバイダーに作成済み。
  M6 計画書「M5 への申し送り」を引き継ぐ

## スコープ

1. **予約確認をLINEトークに出す(無料の応答メッセージ)**: 予約確定(新規・変更)の直後に
   `liff.sendMessages()` で客の発言として短い定型文を送り、Webhook で受けて
   **応答メッセージ(無料)**で予約内容を返す(下記「決めたいこと」1)
2. **Webhook の受け口** `POST /api/line/webhook`: 署名検証 → 定型文のときだけ応答。
   それ以外のメッセージ(客と店のふだんのチャット)には**一切応答しない**
3. **前日リマインド(プッシュ・1予約1通)**: Cron Triggers → 翌日(JST)の確定済み予約で
   LINE の客に送る。`push_messages` に記録(ダッシュボードの送信数・150通超の警告がここで初めて動く)
4. **完了画面の文言**「確認のメッセージをLINEにお送りしました」を、送信できたときだけ出す
   (M2 からの申し送り)
5. **本番切り替え**(M6 からの申し送り): 店の既存の公式アカウントで Messaging API を有効化
   (同じプロバイダー)・応答設定・リッチメニュー・ログインチャネルの公開。手順書を書き、
   ユーザーが実施する

### スコープ外

- **店側への通知**(新規予約・キャンセルをオーナーにプッシュ): プッシュを消費するので
  行わない(下記「決めたいこと」5)。店側は管理画面カレンダーで最新状態を見る(M3・M4 の方針どおり)
- 代行登録(管理画面)の予約の確認メッセージ: 電話で受けた予約なので送らない。
  ただし LINE の客(`line_user_id` あり)なら**前日リマインドは送る**
- キャンセル確認のLINE送信(ADR-002: 画面表示で完結)
- リマインドのメール化・有料プランへの移行(ADR-002「超過リスクの管理」。必要になったら新ADR)
- Flex Message での装飾(下記「決めたいこと」4)

## 対象画面

- `docs/mockups/客側-LIFF(スマホ縦)/05-予約完了`: 見出しの下の補足「確認のメッセージをLINEに
  お送りしました」。**送信に成功したときだけ**表示する(失敗・LINE外で開いた場合は出さない)
- `04-予約確認`: 「前日にLINEでリマインドをお送りします。…」は M2 から表示済み(変更なし)
- LINE トークの見た目(定型文・応答・リマインドの文面)はモックに無い。下記「文面」で擦り合わせる
- 管理画面: 店舗設定(`/admin/settings/salon`)に「リマインドの送信時刻」を1項目足す
  (決めたいこと3。モックに無いので既存の「キャンセル締切」などの行と同じ形にする)

## 事前調査の結果(実物で確認したこと / 推測を区別)

### 1. `liff.sendMessages()`(LIFF API リファレンスで確認)

- 使える条件: **1対1・グループ・複数人トークから起動した LIFF ブラウザ内**、`chat_message.write`
  スコープを客が許可済み、「最近使用したサービス」から再読み込みしていない。満たさないと 403
  (「user doesn't grant required permissions yet」)。キープメモ・URLスキームからの起動も不可
- 送れる種類: テキスト(絵文字・引用なし)・Flex(URIアクションのみ)など最大5件
- リッチメニューから開いた LIFF が「1対1トークから起動」に当たるかは**ドキュメントに記載がない**
  (推測: 当たる。実機で確認する)。`liff.getContext().type === "utou"` で事前に判定できる
- M6 で LIFF のスコープに `chat_message.write` を付ける決定をした(実際に付いているかは
  LINE Developers の画面で確認する)

### 2. 応答メッセージ(Reply API)

- 応答トークンは1回だけ・**Webhook 受信から1分以内**に使う(国内の解説記事。公式の記載箇所は
  実装時に確認する)
- 応答メッセージは月の無料通数に**数えられない**(同上。ADR-002 の前提)
- → Webhook の処理は DB を1回読んで返すだけにし、1分を十分下回る

### 3. プッシュメッセージ(公式ドキュメントで確認)

- **リトライキー** `X-Line-Retry-Key`: 任意の UUID。最初のリクエストから24時間有効。
  受理済みのキーで再送すると **409** で、二重には送られない。対象はプッシュ・マルチキャスト等のみ
  (応答メッセージに付けると 400)
- ブロックされた客・存在しない userId への送信は**通数に数えられない**
- 無料通数を使い切ると 429(「You have reached your monthly limit」)
- 今月の送信数は API(`Get consumption`)でも取れる(パスは実装時に確認)。M5 では
  `push_messages` の記録を正とし、API は照合用に verify-booking で一度見るだけにする
- Webhook の署名: ヘッダー `x-line-signature` = リクエスト本文のチャネルシークレットによる
  HMAC-SHA256 の base64(Workers では Web Crypto で計算する)

### 4. OpenNext のカスタムワーカー(OpenNext ドキュメントで確認)

- 生成されるワーカーは `fetch` しか export しない。`scheduled` を足すには
  `.open-next/worker.js` の `default` を import して `{ fetch: handler.fetch, scheduled }` を
  export するファイルを作り、`wrangler.jsonc` の `main` をそれに向ける
- `scheduled` から Next のコードをどう呼ぶかはドキュメントに無い。下記「Cron の仕組み」の案で、
  実装時に preview(workerd)で確かめる

### 5. 公式アカウントの応答設定(解説記事・推測を含む)

- 手動チャットと Webhook は**併用できる**(2022年12月以降。Classmethod の記事)。
  「手動チャット+応答メッセージ」のままだと、Webhook の応答とは別に OA Manager の
  自動応答メッセージも返ってしまう
- 店は既存アカウントで客とチャットしている(ADR-002)。**チャットを止めずに Webhook を足す**
  必要がある。店のいまの応答設定(応答メッセージ・AI応答の有無)は本番切り替えの前に確認する

## 決めたいこと(ユーザーと擦り合わせ)

1. **予約確認: `liff.sendMessages()`+Webhook の応答メッセージを推奨**
   - 予約確定の直後、完了画面に進む前に、客の発言として定型文(例「予約を確定しました」)を
     送る → Webhook がそれを受け、**DB から**その客の直近の予約を読んで応答で詳細を返す。
     プッシュを使わないので無料(ADR-002 の「無料の応答枠を優先」そのもの)
   - **オーナーにも見える**: OA Manager のチャット画面に「予約を確定しました」と応答が並ぶので、
     店側への通知(決めたいこと5)の代わりにもなる
   - 応答の中身は定型文の文字列を信用せず、`source.userId` で DB を引いて作る(誰でも同じ文を
     手入力できるため)。対象は「その客の確定済み予約のうち、**10分以内に作成**されたもの」。
     無ければ応答しない(店のチャットに任せる)。同じ文を2回送られたら2回応答する(無料・害なし)
   - 送信に失敗しても**予約は確定済み**(ADR-004 の予約処理とは切り離す)。完了画面の
     「確認のメッセージを…」を出さないだけ
   - 代替案: (b) 確認もプッシュ — 月100予約なら確認100+リマインド100で無料枠200通を使い切る。
     却下を推奨。(c) LINE には送らず画面だけ — ADR-002 の決定から外れる
2. **予約変更(M3)のときも確認を送るを推奨**(定型文「予約を変更しました」)。
   キャンセルは送らない(ADR-002「キャンセル確認は画面表示で完結」)
3. **リマインドの送信時刻: 店舗設定に持ち(既定 18時)、Cron は毎時を推奨**
   - 時刻は店ごとに変わりうるので `salon_settings.reminder_hour`(0〜23、既定 18)に置く
     (ADR-007。`wrangler.jsonc` の cron は全店舗共通のリポジトリにあるため店ごとに変えられない)
   - Cron は**毎時0分**に動き、「送信時刻を過ぎていて・未送信で・夜遅すぎない」ものだけ送る。
     1回失敗しても次の時間に送り直せる(冪等性は下記)。無料プランの Cron は5個/アカウントで、
     使うのは1個
   - 店舗設定画面に「前日リマインドの送信時刻」(時のセレクト)を足す。オーナーのみ(既存どおり)
   - 代替案: 時刻をコードに固定(18時)して1日1回だけ動かす。簡単だが ADR-007 から外れ、
     1回の失敗でその日のリマインドが全部落ちる
4. **文面はテキストメッセージを推奨**(Flex Message は使わない)
   - 40代以上中心の客層に、装飾よりも読みやすさ。テキストなら通知のプレビューにもそのまま出る。
     マイ予約の URL(`https://liff.line.me/{LIFF ID}/my`)を本文に入れれば押して開ける
   - 文面は純粋関数で作り、テストで固定する(下記「文面」)
5. **店側への通知: M5 では作らないを推奨**
   - オーナーへのプッシュは1予約1通増え、月100予約で無料枠の半分を使う(ADR-002 の見積もりが崩れる)
   - 予約確認の定型文と応答が OA Manager のチャットに並ぶので、新規・変更はそこで気付ける。
     キャンセルに気付く手段はカレンダーだけになる。キャンセルも定型文
     (「予約をキャンセルしました」)を送ってチャットに残す案もある(**応答はしない**ので
     ADR-002 と矛盾しない)— 要否を決めたい
6. **`LINE_CHANNEL_ID` は使わないので `.env.example` から削除を推奨**(Webhook の署名検証は
   チャネルシークレット、送信は長期のチャネルアクセストークンで足りる)

## すり合わせ済みの決定(2026-10-22)

- 「決めたいこと」1〜6 はすべて推奨案で決定
- 5 の補足: **キャンセル時の定型文は送らない**。客のキャンセルは画面表示で完結し
  (ADR-002)、店側はカレンダーで気付く。LINE のトークに出るのは予約確定・予約変更の
  定型文と応答、前日リマインドの3種類だけ
- 文面は下記「文面」の案で進め、実機確認で直す

## 文面(店名・メニュー名などはすべて DB から)

客の定型文(`liff.sendMessages`):

```
予約を確定しました
```

応答(予約確認):

```
ご予約ありがとうございます。
以下の内容で承りました。

日時: 7月18日(土)11:00〜
メニュー: カット+カラー
担当: 田中
合計: ¥11,550(約150分)

変更・キャンセルはリッチメニューの「マイ予約」からどうぞ。
https://liff.line.me/{LIFF ID}/my
{店名}
```

前日リマインド(プッシュ):

```
【明日のご予約】
日時: 7月18日(土)11:00〜
メニュー: カット+カラー
担当: 田中

ご来店をお待ちしております。
ご都合が変わった場合は「マイ予約」から変更・キャンセルできます。
https://liff.line.me/{LIFF ID}/my
{店名}
```

- 日時・金額の書式は既存の `formatJstDateTimeLabel` / `formatYen` を使う(画面と揃える)
- 「担当」はスタッフ名。メニュー名は予約時点のスナップショット(`reservation_menus`)

## データモデルへの影響

マイグレーション `supabase/migrations/2026102xxxxxxx_m5_notifications.sql`:

```sql
alter table public.salon_settings
  add column reminder_hour smallint not null default 18
    check (reminder_hour between 0 and 23);

-- 前日リマインドは1予約1通(ADR-002)。二重送信の記録をDBが拒否する
create unique index push_messages_one_reminder_per_reservation
  on public.push_messages (reservation_id)
  where type = 'reminder';
```

- 新しいテーブルは作らない(grant の追加は不要。`push_messages`・`salon_settings` は
  `20261021000000_explicit_table_grants.sql` で付与済み)。リマインドの書き込みは service_role
- `reservations` に「確認を送ったか」の列は足さない(決めたいこと1: 応答は作成から10分以内の予約を
  その都度引くだけで、記録が要らない)
- 予約が削除されると `push_messages.reservation_id` は null になる(既存の `on delete set null`)。
  一意インデックスは null を重複とみなさないので影響しない

## 新しい純粋ロジック(テストファースト)

### `src/lib/line-messages.ts`

- `buildBookingConfirmationText(reservation, salonName, myPageUrl)` / `buildReminderText(...)`:
  上の「文面」。メニュー複数・所要時間・店名の有無をテスト
- `CONFIRMATION_TRIGGER_TEXTS`: 定型文(新規・変更)。`isConfirmationTrigger(text)` は前後の
  空白だけ許して完全一致(言い回しが違えば店のチャットとして扱う)
- `myPageUrl(liffId)`: `https://liff.line.me/{id}/my`

### `src/lib/line-webhook.ts`

- `verifyLineSignature(body, signature, channelSecret)`: HMAC-SHA256(Web Crypto)の base64 を
  定数時間で比較。`crypto.subtle` は Node 24 と Workers の両方にあるので lib に置ける
  (DOM・Supabase に依存しない)
- `pickConfirmationEvents(payload)`: Webhook の本文から「1対1トークの・テキストの・定型文の」
  メッセージイベントだけを `{ replyToken, userId, kind }` にして返す。再送イベント
  (`deliveryContext.isRedelivery`)・グループ・スタンプ等は捨てる
- `pickRecentReservation(reservations, now)`: 作成から10分以内の確定済み予約のうち最新

### `src/lib/reminders.ts`

- `reminderWindow(now, reminderHour)`: いまが「送ってよい時間帯」か(送信時刻〜21時台まで。
  それより遅ければ翌朝ではなく**送らない** — 前日の夜中に届くのを避ける)と、対象の
  「翌日(JST)」の範囲 `{ start, endExclusive }`
- `selectReminderTargets(reservations, alreadySent, window)`: 確定済み・`kind = booking`・
  `line_user_id` あり・未送信・**送信時刻より前に作成された**もの(送信時刻の後に入った翌日の予約は、
  直前に確認メッセージを受け取っているので送らない)
- `canSendPush(monthCount)`: 今月の `push_messages` が 200 未満か(使い切ったら送らずログ。
  既存の `pushQuotaStatus` の定数を使う)

## サーバー・UI

- **Webhook**(`src/app/api/line/webhook/route.ts`): 本文を文字列で読む → 署名検証(失敗は 401)→
  `pickConfirmationEvents` → 各イベントで `customers.line_user_id` から予約を引き → 応答 API。
  何があっても LINE には 200 を返す(署名不正以外)。エラーは `console.error`(Workers Logs で見る)
- **LINE API の薄いラッパー**(`src/server/line-messaging.ts`): `replyMessage` / `pushMessage`
  (リトライキー付き)。`fetch` だけで書き、SDK は入れない(依存を増やさない。既存の
  `src/server/line.ts` と同じ書き方)
- **完了画面の送信**(`booking-wizard.tsx` + `src/liff/client.ts`): 予約確定の Result が ok のあと、
  `sendConfirmationMessage(kind)` → 成功なら `StepComplete` に `lineMessageSent` を渡して補足文を出す。
  スタブモードでは送らず false。`liff.getContext().type !== "utou"` なら呼ばずに false
- **リマインド**(`src/server/reminders.ts` + `src/app/api/cron/reminders/route.ts`):
  `salon_settings` と翌日の予約を service_role で読む → `selectReminderTargets` → 1件ずつ
  プッシュ(リトライキー = **予約ID**。予約IDは UUID なので「1予約1通」と一致する)→ 200 か 409 なら
  `push_messages` に insert(一意インデックスの重複は無視)。送信と記録の間で落ちても、次の時間に
  同じキーで送り直すと 409 になり記録だけ追いつく
- **店舗設定**: `salon-settings.ts` の検証に `reminder_hour` を足し(特性化テストを先に)、
  フォームにセレクトを1つ足す

### Cron の仕組み

- `src/worker.ts`(カスタムワーカー): `fetch` は OpenNext の handler をそのまま使い、
  `scheduled` は **同じ handler の `fetch` を内部で呼ぶ**:
  `handler.fetch(new Request("https://internal/api/cron/reminders", { method: "POST",
headers: { authorization: "Bearer " + env.CRON_SECRET } }), env, ctx)`
  — ネットワークに出ないので速く、リマインドの処理は Next の中(既存の Supabase クライアント・
  `server-only` がそのまま使える)。`ctx.waitUntil` で完了を待つ
- `/api/cron/reminders` は公開URLでもあるので `CRON_SECRET`(新しい Secret)が一致しなければ 401。
  比較は定数時間
- `wrangler.jsonc`: `main` を `src/worker.ts` に、`triggers.crons: ["0 * * * *"]`(毎時0分・UTC で
  指定しても毎時なので JST との差は関係ない)
- ローカルでは `npm run dev` で `curl -X POST -H "authorization: Bearer …" /api/cron/reminders`
  を叩いて確認できる(Cron 自体は preview か本番で確認)
- 代替案: `scheduled` の中にリマインド処理を直接書く(Next を通さない)。`server-only` や
  パスエイリアスの解決を wrangler の esbuild 側で揃える必要があり、処理が2系統になるので採らない

## 環境変数(Worker の Variables and Secrets に追加。値はユーザーが入力)

| 変数                        | 種類           | 用途                                                 |
| --------------------------- | -------------- | ---------------------------------------------------- |
| `LINE_CHANNEL_SECRET`       | Secret・実行時 | Webhook の署名検証(Messaging API チャネルの基本設定) |
| `LINE_CHANNEL_ACCESS_TOKEN` | Secret・実行時 | 応答・プッシュ(長期のチャネルアクセストークン)       |
| `CRON_SECRET`               | Secret・実行時 | `/api/cron/reminders` の保護(ランダムな長い文字列)   |
| `LINE_CHANNEL_ID`           | —              | 使わない。`.env.example` から削除(決めたいこと6)     |

- `NEXT_PUBLIC_LIFF_ID` はサーバー側でもマイ予約の URL に使う(ビルド時に埋め込み済み。追加作業なし)
- `deploy-env.ts`(ビルド時チェック)は実行時の秘密を見ないので変更なし。代わりに
  Webhook・Cron の入口で未設定なら例外(`line.ts` の `LINE_LOGIN_CHANNEL_ID` と同じ扱い)

## ADR-002 の通数見積もりとの照合

- 予約確認: 応答メッセージなので **0通**(`liff.sendMessages` を許可しない客・LINE外で開いた客には
  確認が出ないだけで、プッシュで補わない)
- 前日リマインド: **1予約1通**(一意インデックスとリトライキーで二重送信を防ぐ)。
  月100予約で約100通 = ADR-002 の見積もりどおり。代行登録の電話客(`line_user_id` なし)は0通
- 予約変更で翌日の予約が作り直された場合、新しい予約に1通送る(旧予約に送り済みでも)。
  変更は前日リマインドの後にはまれなので見積もりへの影響は小さい
- ブロック中の客への送信は LINE 側で数えられないが `push_messages` には残るので、
  ダッシュボードの数は**実際より多め**になる(安全側。警告が早めに出るだけ)

## アクセス制御・セキュリティ

- Webhook: 署名が合わなければ 401 で何もしない。応答内容は DB の値だけで作る
  (定型文は「応答してよい合図」にすぎない)。他人の予約は userId で引くので出ない
- Cron の入口: `CRON_SECRET`。ミドルウェアの matcher は `/admin/:path*` だけなので `/api/*` は
  素通り(既存どおり。認証は各ルートが持つ)
- 秘密(チャネルシークレット・アクセストークン・`CRON_SECRET`)は Worker の Secret だけに置く。
  ローカルは `.env.local`
- 管理画面の変更は店舗設定の1項目だけ(既存のオーナーチェック+RLS)

## ユーザーにしかできない作業の手順(実装後に詳細を書き足す)

### F. テスト用公式アカウントで Messaging API を有効化

1. LINE Official Account Manager → 設定 → Messaging API → 有効化。**プロバイダーは M6 の B-1 で
   作ったもの**を選ぶ(変更不可。違うと LIFF の userId にプッシュできない)
2. LINE Developers に出来た Messaging API チャネルで、チャネルシークレットと長期の
   チャネルアクセストークンを発行 → Worker の Secret に入れる(+ `CRON_SECRET`)
3. Webhook URL `https://<worker-name>.<subdomain>.workers.dev/api/line/webhook`
   を設定 →「検証」→「Webhook の利用」をオン
4. OA Manager の応答設定: **チャット オン・Webhook オン・応答メッセージ オフ**
5. LIFF のスコープに `chat_message.write` が付いていることを確認

### G. 本番切り替え(店の既存の公式アカウント)

1. いまの応答設定(応答メッセージ・AI応答・あいさつメッセージ)を控える
2. F-1〜F-4 を店のアカウントで行う(既存の応答メッセージを使っていたら、オフにしてよいか
   オーナーに確認する)
3. リッチメニュー(「予約する」「マイ予約」)を作成・公開(M6 の D-3 と同じ)
4. LINE ログインチャネルを**公開**にする(M6 の B-4)
5. テスト用に入れた予約・顧客・Auth ユーザーを削除(M6 の E。SQL を用意する)
6. Worker の `LINE_CHANNEL_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN` を店のチャネルの値に差し替える
   (実行時の値なので再ビルド不要)

## リスク

1. **リッチメニューから開いた LIFF で `sendMessages` が使えない**場合(上の調査1が推測): 予約確認が
   LINE に出ない。代替は「確認だけプッシュ」になり ADR-002 の見積もりが崩れるので、
   その場合は実装を止めて相談する(新ADR)
2. **店の既存の応答設定との衝突**: 応答メッセージ・AI応答を使っていると、定型文に二重に返信する。
   G-1 で確認し、オーナーと決める
3. **応答トークンの期限(1分)**: Workers のコールドスタート+DB 1回で収まる想定(推測)。
   本番で Workers Logs の処理時間を見る
4. **Cron の実行時刻のずれ**: Cron Triggers は数分遅れることがある(推測)。毎時の判定なので
   送信が数分遅れるだけ

## 実施順序

1. 設計文書(本書)の擦り合わせ
2. `line-messages.ts` テストファースト(文面・定型文の判定)→ コミット
3. `line-webhook.ts` テストファースト(署名検証・イベントの選別・直近の予約)→ コミット
4. `reminders.ts` テストファースト(時間帯・対象の選別・無料枠)→ コミット
5. マイグレーション + PGlite 検証(列の既定値・check・一意インデックスで2通目が拒否される)→
   コミット → **`db push` はユーザーに依頼**
6. 店舗設定に送信時刻(特性化テスト → 検証の拡張 → フォーム)→ コミット
7. LINE API ラッパー + Webhook ルート → コミット
8. 完了画面の `sendMessages` と補足文 → コミット
9. リマインドのルート + カスタムワーカー + `wrangler.jsonc` の cron。preview(workerd)で
   `scheduled` を発火させて確認 → コミット
10. 文書: `.env.example`・README・verify-booking の「通知」節・本書の手順 F/G → コミット
11. PR(依頼があれば)→ ユーザー作業 F → マージ → 実機確認 → G(本番切り替え)

2〜4 と 6 は互いに独立。2〜4 は仕様が明確なのでサブエージェントに任せられる(手順4〜7を指示に含める)。

## 検証方法

ローカル:

- `npm test`(新しい lib 3本+店舗設定)・`npm run build`・`npm run lint`
- PGlite: マイグレーションの適用、`reminder_hour` の既定値と範囲外の拒否、
  同じ予約の `reminder` を2行入れると一意制約違反になること(`alter default privileges` はしない)
- `npm run dev`: 署名を付けた Webhook の本文を curl で送り、不正な署名は 401・定型文以外は応答しない
  (応答 API はローカルでは呼ばずログで確認)。`/api/cron/reminders` は `CRON_SECRET` なしで 401
- ブラウザ(スタブ): 予約完了画面に補足文が**出ない**(スタブでは送らない)

デプロイ後(verify-booking の「通知(ADR-002)」節を書き直す):

- テスト用公式アカウントで予約 → トークに定型文と応答が並ぶ・完了画面に補足文が出る
- 予約変更 → 「予約を変更しました」と応答 / キャンセル → LINE には何も出ない
- ふだんのメッセージ(「こんにちは」)には自動応答しない・OA Manager のチャットに届く
- 外部ブラウザで LIFF を開いて予約 → 予約はでき、補足文は出ない
- 送信時刻を今の時刻に合わせ、翌日の予約を入れて次の毎時0分を待つ → リマインドが1通届く・
  ダッシュボードの送信数が1増える・次の時間に2通目が来ない
- 代行登録の電話客(`line_user_id` なし)の翌日予約には送られない
- LINE の `Get consumption` の値と `push_messages` の件数を一度照合する

## 実装の結果(2026-10-22)

実施順序 2〜10 はサブエージェントが実装し、メインでレビューして機能ごとにコミットした。
`npm test`(773件)・`npm run build`・`npm run lint` が通っている。

計画からの変更・確定したこと:

- **メニュー名の区切りは「カット + カラー」**(空白あり)。「文面」節の「カット+カラー」ではなく、
  完了画面・マイ予約と同じ既存の `menuNamesLabel` を使った
- **変更時の応答の冒頭**は「ご予約の変更を承りました。」「変更後の内容は以下のとおりです。」。
  3行目以降は新規と同じ。定型文の種類は `"new" | "change"`(`line-messages.ts` の
  `ConfirmationKind`。`reservations.kind` の booking/block とは別物)
- **送信時刻の設定**は店舗設定の「予約の受付ルール」節の1項目(保存ボタンも共通)。
  補足文は 21時以前と 22・23時で出し分ける(22・23時は「その1時間だけ送る」)。21時の上限は
  `reminders.ts` の `LATEST_SEND_HOUR` を両方で使う
- **LINE API の 409**(受理済みのリトライキー)は `{ ok: true, alreadyAccepted: true }`
  (`src/lib/line-api-result.ts`)。リマインドは 409 でも記録して無料枠に数える
- **記録の一意制約違反(23505)は「記録済み」**(`isPushMessageRecorded`)。部分インデックスなので
  supabase-js の upsert は使わず普通の insert にした(PGlite で `on conflict do nothing` も通ることは確認済み)
- **カスタムワーカーはリポジトリ直下の `worker.ts`**(計画の `src/worker.ts` から変更。OpenNext の
  ドキュメントの例と同じ位置)。`.open-next/worker.js` は `next build` の時点では無いので、
  `tsconfig.json` の `exclude` で型チェックから外した。Cloudflare の型パッケージは入れず、使う分の型を
  ファイル内に書いた。`scheduled` は `https://internal/api/cron/reminders` への POST を同じ handler の
  `fetch` に直接渡す
- **Cron の入口の認証**は `src/lib/cron-auth.ts`(`Bearer {CRON_SECRET}` の定数時間比較)
- `NEXT_PUBLIC_LIFF_ID` は送る予約があるときだけ確かめる(送信時間帯の外で 500 にしないため)

確認できたこと:

- PGlite: マイグレーション全件の適用、`reminder_hour` の既定値18・範囲外の拒否、同じ予約の
  `reminder` 2行目が 23505、`other` と `reservation_id` が null の行は重複してよい、既存の grant
- `npm run dev` と curl: Webhook は署名なし・不正署名が 401、正しい署名の `events: []` と
  定型文以外が 200。Cron の入口は Bearer なし・不一致が 401
- `opennextjs-cloudflare build` → `preview`(Windows): `/cdn-cgi/local/scheduled` で `scheduled` を
  発火させると、内部の fetch が `/api/cron/reminders` に届き、`CRON_SECRET` の認証を通った
  (`env` の値は OpenNext の `populateProcessEnv` で `process.env` に入る)。`wrangler deploy --dry-run`
  は 8,021 KiB(gzip 1,682 KiB)で通り、`scheduled` がバンドルに入っている
- リモートDBへの読み取りだけで、翌日の予約のクエリ(`ov` と埋め込み)と送信済みIDのクエリが通る

確認できていないこと(実機で確認する。verify-booking「通知」節):

- `reminder_hour` 列が未適用のため、Cron の入口が 200 と集計を返すところ・店舗設定の画面
- Webhook の直近の予約のクエリを実データで実行すること、応答・プッシュを実際に送ること
- リッチメニューから開いた LIFF で `liff.sendMessages` が使えるか(リスク1)

残るリスク(推測):

- OpenNext は `scheduled` から渡したリクエストでも `process.env.__NEXT_PRIVATE_ORIGIN` を
  `https://internal` に書き換える。同じ isolate で同時に処理中の Server Action のリダイレクトが
  影響を受けうる時間がごく短くある(毎時1回・数百ms)。本番のホスト名は `scheduled` からは
  分からないので対策していない。症状(管理画面のログイン後のリダイレクト先がおかしい等)が出たら、
  ホスト名を実行時の変数で渡す
- `/api/cron/reminders` が 2xx 以外でも `scheduled` 自体は成功扱い(console.error だけ)。
  Cron の実行履歴で失敗として見たくなったら例外を投げる形に変える

## デプロイと実機確認の結果(2026-10-22)

- マイグレーションはユーザーが `db push` で適用(dry-run で最新を確認)→ PR #10 マージ →
  Workers Builds でデプロイ。Cron Triggers は `wrangler.jsonc` からそのまま登録された
  (画面は UTC 表示で「Every hour」)
- テスト用公式アカウントで Messaging API を有効化し、Webhook の「検証」が成功。
  OA Manager の応答設定は「チャット オン・Webhook オン・応答方法(応答時間内)= 手動チャット」。
  応答時間がオンで「応答時間外 = 応答メッセージ」に見えたため、応答時間外に自動応答が二重に
  返らないよう応答時間をオフにすることを勧めた(画面の読み方は推測。夜間の予約で確認する)

確認できたこと(LINE実機):

- **リッチメニューから開いた LIFF で `liff.sendMessages` が使えた**(リスク1は解消)。
  予約確定 → 客の発言「予約を確定しました」→ 1分以内に応答で予約内容(日時・メニュー・担当・
  合計・マイ予約のURL・店名)。URL の下に LINE のリンクプレビュー(サイトのタイトル・説明文)が付く
- ふだんの発言(「テスト」)には自動応答しない
- 前日リマインド: 送信時刻を14時にし、翌日の予約(14時より前に作成)を用意 → 15:00 に1通届き、
  `push_messages` に `reminder` が1行。16:00 に2通目は来なかった。送信時刻は18時に戻した

起きたこと:

- **14:00 の Cron が HTTP 500**。ログは worker.ts の「Cron(0 * * * *)の前日リマインドが失敗しました:
  HTTP 500」と、ルートの先頭で例外になったスタック。本番の `/api/cron/reminders` に Bearer なし・
  不一致で POST しても 500(正常なら 401)で、Webhook は 401 を返す(`LINE_CHANNEL_SECRET` は見えている)。
  OpenNext の `populateProcessEnv` は文字列の変数をすべて `process.env` に入れる(名前の絞り込みなし)。
  画面の一覧には `CRON_SECRET`(シークレット)があったが、**値を入れ直したら 401 になり**、
  15:00 の回は正常に送られた。中身の違う値なら 401 になるはずなので、値が空のまま保存されていたか、
  実行中の版に入っていなかったと考える(推測。画面の操作は再現していない)。
  M6 の `SUPABASE_SERVICE_ROLE_KEY` と同じく「Secret を入れたら最初に疎通を確かめる」を
  verify-booking と README に追加した
- **開発用スタブの顧客にもリマインドが選ばれる**: M2〜M4 の dev(スタブ)で作った顧客の
  `line_user_id` は `U-dev-user-1` で、翌日の予約が残っていたため対象になった。送信は LINE がエラーで
  返し(記録なし・誰にも届かない・無料枠も減らない)、21時台まで毎時ログにエラーが出る。
  本番前のテストデータ削除(M6 手順 E)で解消する

追加の確認(2026-10-23、LINE実機):

- **同意画面**: LINE アプリの連動アプリで連動を解除して出し直した。`chat_message.write` は
  「トークルームへのメッセージ送信」のトグルとして出る
- **送信を許可しなかった場合**: トグルをオフにして予約 → 予約はでき、完了画面の補足文は出ず、
  トークにも何も出ない(理由の「403 で失敗し false」は LIFF API リファレンスの仕様からの説明で、
  観察はしていない)
- **予約変更**: 「予約を変更しました」と変更後の内容が返る。**キャンセル**: トークには何も出ない
- **応答時間**: OA Manager で「応答時間」をオフにし、「応答時間外」の欄が出ないことを確認。
  応答方法は常に手動チャットになるので、夜間の予約でも自動応答は二重に返らない
- 外部ブラウザの確認項目は想定が誤っていた。予約画面は IDトークンが取れないと
  「LINEアプリから開いてください」を出して進めない(ADR-003)ので、「予約はでき、補足文は出ない」
  にはならない。verify-booking を実装どおりに直した
- PCの外部ブラウザで `/booking` を開くと「LINEアプリから開いてください」が出て進めない
- 予約から10分以上たってから「予約を確定しました」と手入力しても応答しない
- LINE の今月の送信数と `push_messages` の件数が一致

既知の制約(確認しないと決めた。2026-10-23):

- 友だちとの1対1トークに貼った LIFF の URL から予約すると、定型文がその友だちとのトークに出て、
  完了画面に補足文も出てしまう(推測)。`liff.sendMessages` は LIFF を開いたトークに送り、
  `getContext().type` の `utou` は相手が公式アカウントかを区別しないため。客は通常リッチメニューから
  開くので確認しない。問い合わせがあったら対応を検討する

未確認:

- 本番切り替え(店の既存アカウント。手順 G)
