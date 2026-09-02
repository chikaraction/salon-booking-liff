# Milestone 4b: 管理画面 設定系(営業日・スタッフ・メニュー・店舗設定・権限差)

- 日付: 2026-08-31
- 参照ADR: ADR-002(プッシュ無料枠 — M4cで可視化)/ ADR-004(EXCLUDE制約)/
  ADR-005(管理画面と認証・オーナー/スタッフの権限)/ ADR-006(デザインシステム)/
  ADR-007(店舗固有値をコードに書かない = 本マイルストーンの主目的)

## スコープ

M4で切り出した設定系のうち、**店側が自力で店舗固有値を変更できる状態**にするまで。
表示設定(テーマ・フォント)とダッシュボードは **M4c に切り出す**(2026-08-31決定)。

1. **営業日・営業時間の設定**(モックE-2 + 曜日ごとの時刻): 毎週の定休日 /
   第◯曜日の定休 / 祝日を休業にするトグル / 臨時休業・臨時営業(日付範囲)。
   休業日判定を客側の日時選択・管理画面カレンダーの両方へ反映する
2. **スタッフ設定**(モックE): スタッフのCRUD(名前・ロール・表示順・有効/無効)+
   週次勤務パターン(勤務曜日・開始/終了・休憩)+ 臨時休ブロックの追加・削除
3. **メニュー管理**(モックF・F詳細): メニューのCRUD・表示順のドラッグ並べ替え・
   カテゴリの編集ダイアログ(追加・名称変更・並べ替え・削除)
4. **店舗・予約設定**(モックなし・新規): 店名 + 予約ポリシー
   (空き枠の刻み・受付期間・直前締切・キャンセル締切)の編集UI
5. **オーナー/スタッフの権限差**(ADR-005): 設定系はオーナーのみ。
   アプリ層(ナビ非表示・Server Actionでの拒否)+ RLS(書き込みポリシー)の二重

### スコープ外

- **M4c(管理画面・仕上げ)へ**: 表示設定(モックF-2。プリセット3案+フォントのみ、
  カスタム色は将来対応)/ ダッシュボード小物ページ(モックG、150通警告: ADR-002)
- **可変価格・可変時間メニュー**(「¥11,000〜」「180分〜」「所要時間 —」):
  M4bでも見送り(固定価格・固定時間のみ)。実店舗データ投入時に再判断
- スタッフ招待UI: Supabase Authユーザーの作成はダッシュボードで行い、
  `staff.auth_user_id` の紐付けはSQL運用のまま(M4のREADME手順を踏襲)。
  **ただしM4bでロール差が実効化するため、紐付けが未実施だと設定変更ができなくなる**
  → READMEの手順を「必須」に格上げして明記する
- 来店履歴の一覧画面 / LINE通知(M5)/ デプロイ(M6)
- LINEプッシュ送信はM4bでも増えない(読み取りのみ)ため ADR-002 の無料枠への影響なし

## 対象画面

`docs/mockups/店側-管理画面(PC/タブレット)/` の 05・06・06詳細・08 を正とする。
09(表示設定)・07(ダッシュボード)はM4c。読み取れる実装要件:

- **E. スタッフ設定**: カード見出しは「田中(オーナー)」+「勤務・休憩・臨時休の設定」。
  「勤務曜日・時間」= 7曜日のチップ(選択=塗り、非選択=淡色)/「開始」「終了」
  「休憩」の3入力(休憩は「13:00〜14:00」の範囲)。下部に「臨時休を追加」ボックス
  (「7/29(水)は休診に設定済み」の補足 +「+ 追加」ボタン)
- **E-2. 定休日・祝日**: 「休業日を登録すると、その日はお客様の予約画面に表示されず、
  予約を受け付けません(予約枠が開かない)」という説明どおり、**客側の枠計算に効く**
  設定であること。構成は
  - 「毎週の定休日(毎週固定で休む曜日)」= 7曜日チップ(= `business_hours.is_open`)
  - 「特定の週だけの定休日(第◯曜日・隔週など)」= 「[曜日▼] の [第1〜第5]」の行を
    「+ 追加」で増やせる。補足文「毎月 第3日曜日 を定休に設定中。カレンダーの
    該当日は自動で休業になります。」
  - 「祝日を休業にする」トグル(「日本の祝日を自動で休業扱いにします」)
  - 「臨時休業・指定日」= 「+ 日付を追加」。行は「7月21日(月) 海の日・祝日 [休業]」
    「7月29日(水) 臨時休業 [臨時休]」「8月13日(木)〜16日(日) 夏季休業 [連休]」。
    **祝日行は自動導出の読み取り専用、臨時休・連休は登録データ**という混在リスト
- **F. メニュー管理**: ヘッダーに「カテゴリを編集」(アウトライン)+「+ 新規メニュー」
  (プライマリ)。「⣿ を掴んで行をドラッグすると表示順を変更できます」の注記。
  列は メニュー名 / 料金(税込) / 所要時間 / 「編集」リンク。
  カテゴリ名が淡色の区切り行として入る
- **F詳細. カテゴリの編集**: ダイアログ「ドラッグで並べ替え・名称変更・追加ができます」。
  行 = ドラッグハンドル + テキスト入力 + 削除(×)。「キャンセル」「保存する」
- **サイドバー**: M4の「予約カレンダー」「代行登録」に加え、**設定グループ**を追加
  (営業日・営業時間 / スタッフ / メニュー / 店舗・予約設定)。
  オーナー以外には設定グループを表示しない

## データモデルへの影響

### 1. 新テーブル `nth_weekday_closures`(第◯曜日の定休)

```sql
create table public.nth_weekday_closures (
  id uuid primary key default gen_random_uuid(),
  weekday smallint not null check (weekday between 0 and 6),
  nth smallint not null check (nth between 1 and 5),
  created_at timestamptz not null default now(),
  constraint nth_weekday_closures_unique unique (weekday, nth)
);
```

モックの「日曜日 の 第1〜第5(複数選択)」は `(weekday, nth)` の行集合として持つ。
UIの1ブロック(曜日+選択された第◯の集合)は、この行集合を曜日でグルーピングして復元する。

### 2. 新テーブル `date_overrides`(臨時休業・臨時営業)

```sql
create table public.date_overrides (
  id uuid primary key default gen_random_uuid(),
  start_date date not null,
  end_date date not null,
  -- false=休業(臨時休・連休) / true=定休・祝日でも営業する(例外的な営業日)
  is_open boolean not null default false,
  label text,
  created_at timestamptz not null default now(),
  constraint date_overrides_range check (start_date <= end_date),
  -- 同じ日に「休業」と「営業」が同時に登録される曖昧さを構造的に防ぐ
  constraint date_overrides_no_overlap exclude using gist (
    daterange(start_date, end_date, '[]') with &&
  )
);
```

単日は `start_date = end_date`。モックの「8月13日(木)〜16日(日) 夏季休業 [連休]」は
1行で表す(バッジ「休業/臨時休/連休」は日数と `is_open` から**表示側で導出**する)。
`is_open = true` は「祝日だが営業する」の逃がし口で、祝日ライブラリが特例法に
追随できないケースを店側の操作で吸収できるようにするためのもの(下記)。

### 3. `salon_settings` に列追加

```sql
alter table public.salon_settings
  add column close_on_holidays boolean not null default false;
```

### 4. ロール判定関数 + RLSの書き込み制限(オーナーのみ)

```sql
create or replace function public.current_staff_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.staff where auth_user_id = auth.uid()
$$;
```

既存の `for all to authenticated using (true) with check (true)` を、
**設定系テーブル**(`salon_settings` / `business_hours` / `staff` /
`staff_working_hours` / `menus` / `menu_categories` / `nth_weekday_closures` /
`date_overrides`)について次のように分割する:

- `for select to authenticated using (true)` — 閲覧は全スタッフ可
  (カレンダー・代行登録がこれらを読むため)
- `for insert/update/delete to authenticated` は
  `public.current_staff_role() = 'owner'` のみ

`reservations` / `reservation_menus` / `customers` / `push_messages` は
**現状どおり authenticated 全操作可**(スタッフも代行登録・キャンセル・スタッフメモ
編集を行うため: ADR-005 の「スタッフ: 予約の閲覧・代行登録・代行キャンセル」)。

> **運用上の注意**: `staff.auth_user_id` が未紐付けのユーザーは `current_staff_role()`
> が NULL になり、設定変更が一切できなくなる。READMEの紐付け手順を必須手順に
> 格上げし、検証項目にも入れる。

### 5. RPCの追加はしない

設定系はいずれも単一テーブルの単文更新で足りる(authenticatedクライアント+RLS)。
例外はメニュー/カテゴリの並べ替えで複数行の `display_order` を一括更新する箇所だが、
`upsert` の配列1回で済むためRPCは作らない。

マイグレーションはPGlite(btree_gist + authスタブ)で事前検証し、
`npx supabase db push` はユーザーに依頼する。

## 祝日の扱い(2026-08-31決定)

- npm の **`japanese-holidays`**(MIT・依存なし・137KB)を採用する
- **API は `getHolidaysOf(year)` のみ使う**。実物で確認した挙動:
  - `getHolidaysOf(year)` は `{ month, date, name }` の配列を返し、**タイムゾーンに
    依存しない**(2026年は18件、うち振替休日込み。任意の未来年も算出できる)
  - 一方 `isHoliday(date)` は `Date#getMonth()/getDate()` という**実行環境のローカル
    時刻**で判定するため、UTCで動くCloudflare上ではJSTの日付とずれる。**使わない**
- 型定義が同梱されていないため `src/types/japanese-holidays.d.ts` を自前で置く
- 算出式ベースのため、五輪移動のような一回限りの特例法には追随しない。
  その場合は `date_overrides`(`is_open = true` で営業 / `false` で休業)で上書きする

## 新しい純粋ロジック(テストファースト)

### `src/lib/closures.ts` — 休業日判定(本マイルストーンの中核)

```ts
export type ClosureRules = {
  businessHours: Array<{ weekday: number; isOpen: boolean }>;
  nthWeekdayClosures: Array<{ weekday: number; nth: number }>;
  closeOnHolidays: boolean;
  overrides: Array<{
    startDate: string; endDate: string; isOpen: boolean; label: string | null;
  }>;
};
export type ClosureReason = "override" | "holiday" | "nth-weekday" | "weekly";
export type DayClosure = {
  isClosed: boolean;
  reason: ClosureReason | null;
  label: string | null; // 「海の日・祝日」「夏季休業」など
};

export function nthWeekdayOfMonth(date: string): number;      // その月の第何◯曜日か
export function japaneseHolidayName(date: string): string | null; // ライブラリのラップ
export function resolveDayClosure(date: string, rules: ClosureRules): DayClosure;
export function makeIsClosedDay(rules: ClosureRules): (date: string) => boolean;
export function buildClosureListItems(params: {                // E-2下部の混在リスト
  from: string; days: number; rules: ClosureRules;
}): Array<{ dateRangeLabel: string; label: string; badge: "休業" | "臨時休" | "連休" }>;
```

判定の優先順位(上が強い): `date_overrides` → 祝日 → 第◯曜日 → 毎週の定休。
`makeIsClosedDay` は `buildWeekView` の `isClosedDay` 受け口
(M4で用意済み)にそのまま嵌める。

### `src/lib/staff-settings.ts`

- 勤務パターンのバリデーション(`start < end` / 休憩は勤務時間内 / 休憩は開始・終了の
  ペア)。DB制約(`staff_working_hours_*`)と同じルールをUIでも先出しする
- 曜日チップのON/OFF → `staff_working_hours` のupsert/delete差分
- 臨時休ブロックの `during` 算出(終日 = その日の勤務時間全体、時間帯指定 = 指定範囲)
- 「7/29(水)は休診に設定済み」のラベル整形(今後のブロック一覧から)

### `src/lib/menu-settings.ts`

- 並べ替え結果 → `display_order` の再採番(変更が必要な行だけ返す)。
  並べ替えは**カテゴリ内に限定**する(カテゴリ変更はメニュー編集ダイアログで行う)
- メニューのバリデーション(名前必須・料金 >= 0・所要時間 > 0)
- カテゴリ削除の可否判定(所属メニューが1件でもあれば不可 —
  `menus.category_id` は NOT NULL)とエラーメッセージ

### `src/lib/salon-settings.ts`

- 店名・予約ポリシー(刻み・受付期間・直前締切・キャンセル締切)のバリデーション
- 曜日ごとの営業時間のバリデーション(`open < close`、営業ONなら時刻必須 —
  `business_hours_times_required` と同じルール)

### `src/lib/admin-permissions.ts`

- `canManageSettings(role: string | null): boolean`
- サイドバーのナビ項目をロールで絞る関数、権限エラーメッセージ

### 既存ロジックの変更(先に特性化テストで挙動を固定する)

- `src/lib/calendar.ts` の `isSelectableDate`: 現在は `business_hours.isOpen` だけを
  見ている。`isClosedDay` を受け取る形に拡張する
- `src/lib/admin-calendar.ts` の `isClosedByBusinessHours`: 週表示の休業判定を
  `closures.ts` 経由に寄せる(既存の関数は互換のため残すか、呼び出し側を差し替える)

DOM・Supabaseクライアントのimport禁止。describe/itは日本語。

## サーバー・UI

- 依存追加: `japanese-holidays`(祝日)/ `@dnd-kit/core` + `@dnd-kit/sortable`
  (並べ替え。実物で確認: peer は `react >= 16.8` で React 19 と両立、
  sortable 10.0.0 は core ^6.3.0 を要求)
- **認可**: `src/server/admin-auth.ts` に `getCurrentStaff()` を追加
  (`auth.uid()` → `staff` 行 → `role`)。保護レイアウトのほか、
  設定系レイアウト `/admin/settings/layout.tsx` でオーナーを再確認(二重チェック)
- **データ取得** `src/server/settings-data.ts`: 営業時間・定休ルール・
  スタッフ+勤務パターン・メニュー+カテゴリ・店舗設定の取得。
  すべて authenticated クライアント(RLS適用)。service_role は使わない
- **Server Action** `src/app/admin/settings/actions.ts`(Result型):
  各設定の保存、臨時休ブロックの追加・削除、並べ替えの永続化。
  **先頭で必ずオーナー判定**(RLSが最後の砦、アプリ層はUX)
- **ルーティング**:
  - `/admin/settings/business` — 営業日・営業時間(モックE-2 + 曜日ごとの時刻)
  - `/admin/settings/staff` — スタッフ設定(モックE)
  - `/admin/settings/menus` — メニュー管理(モックF・F詳細)
  - `/admin/settings/salon` — 店名・予約ポリシー(モックなし)
- `src/lib/admin-nav.ts` の `isAdminNavActive` は完全一致判定なので、
  設定配下でも親項目がアクティブになるよう前方一致を追加する(テスト追加)
- レスポンシブはTailwindのブレークポイント。テーマは現行トークン(テーマB モーヴ)
  のまま(切替はM4c)

## 客側への反映(重要)

E-2の説明文どおり、休業日は**客側の予約枠が開かない**ことまでが要件:

- `src/server/booking-data.ts` が営業日を組み立てる箇所で、`closures.ts` の判定が
  休業なら `businessDay.isOpen = false` として `computeStaffDaySlots` に渡す
  (M2のコメント「第◯曜日・祝日・指定日ルール(M4)は isClosedDay に載せる」を回収)
- 月カレンダーの日付選択も同じ判定で不可にする(`isSelectableDate`)
- 管理画面カレンダーの週表示の斜線ハッチングも同じ判定に統一する

## アクセス制御(ADR-005の検証必須項目)

- スタッフロールでログイン → サイドバーに設定グループが出ない。
  `/admin/settings/*` を直接開いても弾かれる。Server Actionを直接叩いても拒否される
- スタッフロールのセッションでテーブルを直接UPDATE → **RLSで拒否**される
  (アプリ層を迂回しても止まること)
- スタッフロールでも予約カレンダー・代行登録・店側キャンセルは従来どおり可能
- `staff.auth_user_id` 未紐付けのユーザーは設定変更不可(READMEの手順が必須である確認)
- anonキーでは全テーブル読み書き不可(既存方針の再確認)

## 実施順序

機能単位で都度コミット。ロジックはテストファースト。実装(src/ 配下)は
サブエージェントに委譲し、成果物はメイン側でレビューする。

1. 設計文書(本ファイル)→ すり合わせ → コミット
2. マイグレーション: `nth_weekday_closures` / `date_overrides` /
   `salon_settings.close_on_holidays` / `current_staff_role()` + RLSの書き込み分割
   (PGliteで検証 → `db push` はユーザーに依頼)
3. `src/lib/closures.ts`(テストファースト)+ 既存判定の差し替え
   (`calendar.ts` / `admin-calendar.ts` / `booking-data.ts` は特性化テスト先行)
4. 権限差: `admin-permissions.ts` + `getCurrentStaff()` + 設定レイアウトの
   オーナー確認 + サイドバーの設定グループ(ロールで出し分け)
5. 営業日・営業時間の設定画面(モックE-2 + 曜日ごとの時刻)
6. スタッフ設定画面(スタッフCRUD → 勤務パターン → 臨時休ブロック)
7. メニュー管理(一覧+編集ダイアログ → カテゴリ編集ダイアログ → @dnd-kit の並べ替え)
8. 店舗・予約設定画面(店名・予約ポリシー)
9. 検証 + verify-booking チェックリスト更新 + README更新
   (`auth_user_id` 紐付けを必須手順へ格上げ)

## 検証方法

- `npm test`: 休業日判定(優先順位・第◯曜日の境界・祝日・日付範囲の端)・
  勤務パターンのバリデーション・臨時休ブロックの`during`算出・並べ替えの再採番・
  カテゴリ削除の可否・権限判定・E-2の混在リスト整形。
  既存挙動の特性化テスト(`isSelectableDate` / 週表示の休業判定 / 客側の枠計算)
  PGlite: `date_overrides` の重なりEXCLUDE / `current_staff_role()` を使ったRLS
  (owner は更新可・staff は拒否)
- `npm run build` / `npm run lint`
- ブラウザスモーク(オーナー用・スタッフ用の2ユーザーで):
  - 第3日曜を定休に設定 → 管理画面の週表示が斜線になり、**客側の日時選択で
    その日が選べない**(往復確認)
  - 「祝日を休業にする」ON → 直近の祝日が休業になる。`date_overrides` に
    「その祝日は営業」を入れると営業に戻る
  - 連休(8/13〜16)を登録 → リストに「連休」バッジ、客側で4日とも選べない
  - スタッフの水曜をOFF → 水曜の枠が客側に出ない。臨時休を追加 →
    カレンダーにブロックが出る。**既存予約と重なる臨時休は登録できずエラー**(23P01)
  - メニューを新規追加 → 客側のメニュー選択に出る。非表示にすると消えるが、
    **そのメニューを含む過去の予約の表示は壊れない**(スナップショット)
  - カテゴリの名称変更・並べ替え → 客側の見出し順が変わる。
    メニューが残っているカテゴリは削除できない
  - 予約ポリシー(刻み15分・受付期間14日・直前締切120分)を変更 → 客側に反映される
  - スタッフロールで設定URLを直接開く → 弾かれる
- verify-booking に追記して確認: 上記アクセス制御・休業日の客側反映・
  臨時休と予約の競合(23P01)・管理画面レスポンシブ実機

## すり合わせ済みの決定(2026-08-31)

1. **スコープ分割**: M4b = 営業日・スタッフ・メニュー・店舗設定・権限差。
   M4c = 表示設定(テーマ・フォント)+ ダッシュボード小物
2. **祝日データ**: `japanese-holidays`(算出式・任意の年に対応)を採用し、
   `getHolidaysOf(year)` のみ使う。特例法のずれは `date_overrides` で吸収する
3. **並べ替えUI**: モック準拠で `@dnd-kit` のドラッグ&ドロップ。
   並べ替えの再採番ロジックは `src/lib/menu-settings.ts` に純粋関数で置く
4. **権限差**: アプリ層(ナビ非表示・Server Actionでの拒否)+ RLS(設定系テーブルの
   書き込みをオーナーのみ)の二重。`current_staff_role()` を新設する
5. **休業まわりの命名規約**: 「店が休む」= `closed` / `closure`、「日本の祝日」=
   `holiday` に用語を固定する。既存コード(`isClosed` / `isClosedByBusinessHours` /
   `ClosedDayBanner`)がすでに `closed` を使っており、祝日は定休より強い別ルール
   (優先順位が違う)なので、両者に同じ語を当てない。
   したがって定休日テーブルに `regular_holidays` は使わず、
   内容そのままの `nth_weekday_closures`(第◯曜日の定休)とする。
   毎週固定の定休は引き続き `business_hours.is_open` が持つ
