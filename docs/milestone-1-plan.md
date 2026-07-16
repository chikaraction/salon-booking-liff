# Milestone 1: プロジェクト雛形 + Supabaseスキーマ + 開発ツーリング

- 日付: 2026-07-16
- 参照ADR: 全ADR(特に ADR-001 スタック / ADR-004 EXCLUDE制約 / ADR-005 管理画面認証 / ADR-007 シングルテナント)

## スコープ

このマイルストーンでは**画面は作らない**。以降の全マイルストーンの土台を固める。

1. Next.js(App Router)+ TypeScript + Tailwind + shadcn/ui の雛形
2. Prettier + ESLint のセットアップ(`.claude/hooks/lint-file.mjs` が単一ファイルに
   `npx prettier --write` / `npx eslint --fix` を実行できること)
3. Vitest のセットアップ(`npm test` で `src/lib/` の純粋ロジックをテスト)
4. Supabase 初期スキーマのマイグレーションファイル(EXCLUDE制約含む)
5. CLAUDE.md のコマンド欄を実コマンドに更新、README(セットアップ手順)

### スコープ外(以降のマイルストーン)

- M2: 客側予約フロー(LIFF: メニュー→スタッフ→日時→確認→完了)+ 空き枠計算ロジック
- M3: マイ予約(客自身のキャンセル・変更)
- M4: 管理画面(ログイン、予約カレンダー、代行登録、スタッフ/メニュー設定)
- M5: LINE通知(予約確認の応答メッセージ、前日リマインドの Cron Triggers)
- M6: Cloudflare デプロイ(OpenNext アダプタ)— 雛形時点では組み込まない

## 対象画面

なし(docs/mockups/ は M2 以降で参照)。ただしスキーマはモック指示書
(docs/mockup-brief.md)の全画面要件を満たすよう設計する。

## データモデル

### 設計方針

- ADR-007: 店舗IDは持たない。店名・メニュー・営業時間などはすべてDBデータ
- ADR-004: ダブルブッキング防止の本体は `reservations` の EXCLUDE 制約。
  臨時休などの「予約不可時間」も同テーブル(`kind = 'block'`)で表現し、
  同じ制約で予約との重複をDBレベルで拒否する
- 週次の勤務パターン(勤務曜日・時間・休憩)は「ルール」であってインスタンス
  ではないため、空き枠計算(`src/lib/`、M2)でアプリ側フィルタとして扱う。
  DB制約が最後の砦になるのは「確定済み予約・ブロック同士の重複」
- 客側(LIFF)は Supabase Auth を使わない(ADR-003: LINEログイン)。顧客操作は
  Server Action / Route Handler が LINE IDトークンを検証したうえで service_role
  で実行する。RLS は「anon 拒否・authenticated(=店側スタッフ)許可」を基本とする

### テーブル

| テーブル | 役割 | 主な列 |
|---|---|---|
| `salon_settings` | 店舗設定(単一行) | name |
| `business_hours` | 店の営業時間(曜日ごと) | weekday(PK), is_open, open_time, close_time |
| `staff` | スタッフ(施術者 兼 管理画面ユーザー) | name, role('owner'/'staff'), auth_user_id(→auth.users, 招待制), photo_url, bio, display_order, is_active |
| `staff_working_hours` | スタッフの週次勤務パターン | staff_id, weekday, start_time, end_time, break_start, break_end |
| `menus` | メニュー | name, category(自由入力), price, duration_minutes, display_order, is_active |
| `customers` | 顧客 | line_user_id(unique, 電話客はNULL), name, phone, note |
| `reservations` | 予約+予約不可ブロック | customer_id(blockはNULL), staff_id, during(tstzrange), status('confirmed'/'cancelled'), kind('booking'/'block'), source('line'/'admin'), note, cancelled_at |
| `reservation_menus` | 予約⇔メニュー(複数選択可) | reservation_id, menu_id, menu_name/price/duration_minutes(予約時点のスナップショット) |
| `push_messages` | LINEプッシュ送信ログ(無料枠200通の可視化用: ADR-002) | reservation_id, type('reminder'等), sent_at |

### EXCLUDE制約(ADR-004の精緻化)

```sql
create extension if not exists btree_gist;

alter table reservations add constraint reservations_no_overlap
  exclude using gist (staff_id with =, during with &&)
  where (status = 'confirmed');
```

- キャンセル済み(`status = 'cancelled'`)は重複判定から除外
- `kind = 'block'`(臨時休・休憩ブロック)も `confirmed` なら判定に含まれる
  → 予約とブロックの重複もDBが拒否
- 制約違反(SQLSTATE `23P01`)をアプリ側で捕捉し「その枠は埋まりました」表示(M2)

### スナップショット方針

`reservation_menus` にメニュー名・料金・所要時間を複製して保存する。
メニューの料金改定・削除が過去の予約表示を壊さないため。

## 実施順序

1. 設計文書(本ファイル)→ コミット
2. git init + 既存ドキュメントの初期コミット + feature ブランチ作成
3. create-next-app で雛形(TS / Tailwind / App Router / src-dir)→ shadcn/ui init
4. Prettier + ESLint(eslint-config-prettier で競合排除)→ hooks が通ることを確認
5. Vitest セットアップ(`npm test`)
6. Supabase: `supabase init` + 初期スキーママイグレーション + RLS + seed(開発用ダミー)
7. `.env.example` / README / CLAUDE.md 更新
8. `npm run build` / `npm test` / `npm run lint` を通して機能単位でコミット

## 検証方法

- ローカル: `npm run build`(型チェック込み)、`npm test`、`npm run lint`、
  hooks(lint-file.mjs)を実ファイルで動作確認
- **Dockerがこの環境にないため、マイグレーションのローカル適用は不可。**
  EXCLUDE制約の競合動作(同時INSERTの一方が23P01で失敗すること)は、
  Supabaseプロジェクトへの適用後に verify-booking スキルのチェックリストで確認する
