# Milestone 4c: 管理画面 仕上げ(表示設定・ダッシュボード小物)

- 日付: 2026-10-20
- 参照ADR: ADR-002(プッシュ無料枠 — 150通超の警告)/ ADR-005(設定はオーナーのみ)/
  ADR-006(デザインシステム・トークンは1ファイル)/ ADR-007(店舗固有値をコードに書かない)
- 前提: M4b で切り出した残り(`docs/milestone-4b-plan.md`「スコープ外」)と、
  M4b からの申し送り2件(ダークトークン未整備 / `--primary` の濃い側)

## スコープ

1. **表示設定**(モックF-2): テーマカラーのプリセット3案(A セージグリーン / B モーヴ /
   C スレートブルー)とフォント(Noto Sans JP / LINE Seed JP)を選んで保存する。
   **客側(LIFF)・管理画面の両方**に効く(モックの説明文「お客様画面・管理画面の配色と
   フォントを設定します」)。オーナーのみ(ADR-005)
2. **ダッシュボード小物**(モックG): 今日の予約件数(スタッフ別内訳)/ 今月の予約件数
   (先月比)/ 今月のLINEプッシュ送信数(200通の無料枠に対する使用量バー)
3. **150通超の警告**(ADR-002「月のプッシュ送信数が150通を超えたら管理画面に警告を出す」):
   ダッシュボードのカードと、全画面に出ているサイドバーのミニ集計の両方
4. **ダークテーマの扱いを確定する**(M4b申し送り): 下記「決めたいこと」1

### スコープ外

- **カスタム色**(モックの「+ カスタム」): 2026-07-17 の決定どおり将来対応。
  カードは**グレーアウトして選べない**状態で表示する(M4計画「すり合わせ済みの決定」3)
- LINEプッシュの送信そのもの(M5)。M4c時点では `push_messages` に書き込む処理が
  無いので、送信数は常に0件。表示・警告のロジックは純粋関数のテストで担保する
- LINEプッシュは M4c でも増えない(読み取りのみ)ため ADR-002 の無料枠への影響なし

## 対象画面

`docs/mockups/店側-管理画面(PC/タブレット)/` の 07・09 を正とする。

- **F-2. 表示設定**: カード見出し「表示設定」+ 補足「お客様画面・管理画面の配色と
  フォントを設定します」。
  - 「テーマカラー」= 2×2 のカード。各カードは丸い色見本 + 名前 + 一言
    (「A. セージグリーン / 自然体・清潔感」「B. モーヴ / 採用中」「C. スレートブルー /
    落ち着き・信頼感」)。選択中のカードは**枠=テーマ色・地=淡色・右上にチェック**で、
    一言が「採用中」に置き換わる。4枚目「+ カスタム / 好きな色を指定」は破線枠
    (M4cではグレーアウト)
  - 注記「「カスタム」を選ぶと任意の色を指定でき…」→ M4cでは「カスタム色は今後
    対応予定です。」に差し替える(選べないものの説明を出さない)
  - 「フォント」= 2択のセグメント(選択中=テーマ色の塗り)
  - 「保存する」(プライマリ)
- **G. ダッシュボード小物**: 上段に2枚(「今日の予約件数 6件 / 田中 3件 ・ 佐藤 3件」
  「今月の予約 72件 / 先月比 +8件」)、下段に1枚(「今月のLINEプッシュ送信数 128 / 200 通」
  右上「無料枠 200通」、使用量バー、「残り72通。前日リマインドで使用しています。」)

## 決めたいこと(ユーザーと擦り合わせ)

1. **ダークテーマ: 提供しない(ライトのみ)を推奨**。
   - モックはライトのみ、客層は40代以上中心で、テーマは「1色+ニュートラル」(ADR-006)。
     プリセット3案×ダークのトークン設計と実機確認はコストに見合わない
   - やること: `globals.css` の `.dark` ブロックを削除 / `button.tsx` の `dark:`
     ユーティリティを削除 / `html` に `color-scheme: light` を指定(OSがダークでも
     フォーム部品やスクロールバーが暗くならない)
   - **`@custom-variant dark (&:is(.dark *))` は残す**(M4b申し送りでは「削除」と書いたが
     訂正)。Tailwind v4 は custom-variant を消すと `dark:` が既定の
     `prefers-color-scheme: dark` に戻るため、今後 shadcn の部品を足したときに同梱の
     `dark:` クラスが**OSのダーク設定で勝手に効いてしまう**。`.dark` クラスはどこでも
     付与しないので、残しておけば `dark:` は常に無効になる(コメントで意図を明記)
2. **フォントの既定値: LINE Seed JP(現状維持)を推奨**。モックは Noto Sans JP を選択中に
   描いているが、実装は ADR-006 の選択肢から LINE Seed JP を採用して運用してきた。
   マイグレーションの既定値で見た目を変えないようにし、切り替えはオーナーに委ねる
3. **ダッシュボードの置き場所: 独立ページ `/admin/dashboard` を推奨**。メインナビの
   「代行登録」の下に「ダッシュボード」を足し、**オーナー・スタッフとも閲覧可**
   (数値の閲覧だけで設定変更ではないため。ADR-005 の権限差は設定系のみ)。
   予約カレンダー(ホーム)は現状のまま。150通超の警告はサイドバーのミニ集計にも出るので、
   ダッシュボードを開かなくても気付ける

## データモデルへの影響

`salon_settings`(単一行)に2列を追加するマイグレーション
`supabase/migrations/20261020000000_m4c_display_settings.sql`:

```sql
alter table public.salon_settings
  add column theme_preset text not null default 'mauve'
    check (theme_preset in ('sage', 'mauve', 'slate')),
  add column font_family text not null default 'line_seed_jp'
    check (font_family in ('noto_sans_jp', 'line_seed_jp'));
```

- 既定値は現状の見た目(モーヴ + LINE Seed JP)。既存行は既定値で埋まる
- RLS は M4b の `salon_settings` のポリシー(閲覧=店側スタッフ・変更=オーナー)が
  そのまま効くので追加しない
- 値は**色そのものではなくプリセットID**。色の定義は `globals.css` だけに置く
  (ADR-006「トークンは1ファイル」)。DBに色を持つのはカスタム色(将来)のとき
- ダッシュボードはスキーマ変更なし(`reservations` と `push_messages` の集計)

## テーマ・フォントの仕組み

- ルートレイアウト(`src/app/layout.tsx`)が `salon_settings` を読み、
  `<html data-theme="sage|mauve|slate" data-font="noto_sans_jp|line_seed_jp">` を付ける。
  客側は匿名なので service_role クライアントで読む(列は表示用の2列だけ)。
  React の `cache` で1リクエスト1回に抑える
- **取得に失敗したら既定値で描画する**(例外にしない)。配色は表示の好みであり、
  これのせいで予約画面ごと落ちるのは割に合わない。失敗はサーバーログに残す。
  DBの値が想定外(列の check で起きないはずだが)の場合も既定値に倒す — この判定は
  純粋関数(下記 `resolveDisplaySettings`)
- `globals.css`: `:root` が既定(モーヴ)。`[data-theme="sage"]` /
  `[data-theme="slate"]` が差分のトークンだけを上書きする。セレクタを `:root[...]` に
  しないのは、**表示設定画面の色見本・プレビューを `data-theme` を付けた要素で囲むだけで
  そのプリセットの色にできる**ようにするため(色の値をTS側に二重に持たない)
- プリセットで変わるトークンは `--primary` / `--ring` / `--accent` /
  `--accent-foreground` / `--primary-strong`(下記)の5つ。背景・カード・境界線などの
  ニュートラル(彩度0.012以下の暖色寄り)は全プリセット共通
- フォント: `next/font/google` の `Noto_Sans_JP`(variable・`preload: false`)と既存の
  LINE Seed JP(local)の両方の変数を `html` に付け、`--font-sans` を
  `[data-font=...]` で切り替える。Noto Sans JP はビルド時に取得して自己ホストされる
  (`next/dist/compiled/@next/font/dist/google/font-data.json` で variable 対応を確認。
  subsets に japanese は無く、日本語は unicode-range 分割で配信されるので preload しない)
- 保存後は `revalidatePath("/", "layout")` で全画面に反映する

### `--primary` の濃い側(M4b申し送り)の扱い

`color-mix(in oklch, var(--primary), var(--foreground) 35%)` の派生は、
モーヴ以外では**色相が崩れる**ことを計算で確認した(oklch の混合は色相も補間するため、
`--foreground` の色相35へ寄る):

| プリセット | `--primary`(モック accent) | 白文字 on primary | 派生 35% の結果 | モック accentDark | accentDark on 白 |
| --- | --- | --- | --- | --- | --- |
| A セージ | #5B7B6F oklch(0.555 0.041 170) | 4.66 | #545b48(オリーブ寄り) | #3F5A50 | 7.53 |
| B モーヴ | 現行 oklch(0.58 0.05 22) | 4.38 | #705453 | #7A4F4F | 6.87 |
| C スレート | #4F6D7A oklch(0.516 0.040 227) | 5.52 | #4f4f61(紫寄り) | #3A525C | 8.26 |

派生で「`--primary` だけ替えれば追従する」は成り立たないので、**`--primary-strong` を
プリセットごとの固定値トークン**にする(値はモックの accentDark をoklchにしたもの。
3案とも白地で 6.8:1 以上)。ダークを提供しない(決めたいこと1)ので、派生にしていた
「ダークで自動的に明るい側へ寄る」利点も不要になる。固定値なので Lightning CSS の
制約(`var()` を含む `color-mix` が落ちる)も関係なくなり、`:root` に置ける。
`@theme inline` の `--color-primary-strong` は `var(--primary-strong)` を指すだけにする。

- モーヴの `--primary` は**現行値のまま**(モック #9E6B6B より彩度が低いが、M1〜M4bで
  承認済みの見た目を変えない)。濃い側は #7A4F4F に揃う(現行派生 #705453 と明度差わずか)
- `--accent`(淡色の面)は現行モーヴの明度・彩度(0.93 / 0.022)を保ち色相だけを
  各プリセットに合わせる。`--accent-foreground` も同様(0.38 / 0.035)
- **注意: 白文字 on primary はモーヴが 4.38:1 で AA(4.5)未満**。これは M1 から
  承認済みの現状で、M4c では変えない(セージ・スレートは AA を満たす)

## 新しい純粋ロジック(テストファースト)

### `src/lib/display-settings.ts`

- `THEME_PRESETS`: id / 表示名 / 一言(「A. セージグリーン」「自然体・清潔感」など)。
  UI文字列であって店舗固有値ではない(どの店でも同じ候補)
- `FONT_OPTIONS`: id / 表示名
- `resolveDisplaySettings(row | null)`: DBの値(または取得失敗の null)を
  `{ themePreset, fontFamily }` に。未知の値・null は既定値(mauve / line_seed_jp)
- `validateDisplaySettingsInput(formValues)`: Server Action の入力検証
  (未知のIDは拒否してエラーメッセージ)

### `src/lib/dashboard.ts`

- `monthRanges(today)`: JST暦日 "YYYY-MM-DD" から今月・先月の
  `{ start, endExclusive }`(年またぎ: 1月 → 先月は前年12月)
- `formatMonthOverMonth(thisMonth, lastMonth)`: 「先月比 +8件」「先月比 −3件」
  「先月比 ±0件」
- `summarizeTodayByStaff(reservations, staff)`: スタッフ別件数。表示順は
  `staff.display_order`。**有効なスタッフは0件でも出す**、無効化済みでも当日予約が
  あれば出す(件数の合計と内訳が食い違わないように)
- `pushQuotaStatus(count)`: `{ count, limit: 200, remaining, ratio, level }`。
  level は `ok`(〜150)/ `warning`(151〜200: ADR-002「150通を超えたら」)/
  `over`(201〜)。残りは0未満にしない。バー幅の比率は1で頭打ち
- `pushQuotaMessage(status)`: 「残り72通。前日リマインドで使用しています。」/
  warning:「今月の送信数が150通を超えました。残り{n}通です。」/
  over:「無料枠の200通を超えました。超過分は送信できない可能性があります。」
  (文言は擦り合わせ対象)

既存の `PUSH_MONTHLY_FREE_LIMIT`(`src/server/admin-data.ts`)は lib へ移し、
警告しきい値 150 と並べて定義する(サーバー層に判断の定数を置かない)。

## サーバー・UI

- `src/app/admin/(protected)/settings/display/page.tsx` + `_components/display-settings-form.tsx`:
  F-2 の配線。色見本は `<span data-theme={id} className="bg-primary">` で
  CSSトークンをそのまま使う。保存は Server Action `saveDisplaySettings`
  (`settings/actions.ts`、既存の設定保存と同じオーナーチェック → update → revalidate)
- サイドバーの設定グループに「表示設定」(`/admin/settings/display`、アイコン Palette)
- `src/app/admin/(protected)/dashboard/page.tsx`: G の配線。データは
  `src/server/admin-data.ts` に `getDashboardSummary` を足す(今日の予約の
  staff_id 一覧 / 今月・先月の件数 / 今月のプッシュ数)
- `MiniSummary`: `pushQuotaStatus` の level が warning/over のときバーを
  `bg-destructive` にし、下に短い警告文を出す
- 未保存の変更の扱いは既存の設定画面(`settings/_components/unsaved-changes.tsx`)に揃える

## アクセス制御

- 表示設定: `settings/layout.tsx` のオーナーチェック(アプリ層)+ `salon_settings` の
  RLS(変更はオーナーのみ)の二重。スタッフロールで `/admin/settings/display` を直接
  開くと「権限がありません」
- ダッシュボード: `(protected)` 配下なので未ログインはログインへ。ロールは問わない
- ルートレイアウトの service_role 読み取りは表示用の2列に限定する(`select` で列を明示)

## 実施順序

1. 設計文書(本書)の擦り合わせ
2. ライトのみ化(`.dark` 削除・`dark:` 削除・`color-scheme: light`)— 見た目不変を確認
3. `display-settings.ts` テストファースト
4. マイグレーション + PGlite 検証(列追加・既定値・check 違反)→ **`db push` はユーザーに依頼**
5. テーマトークン(3プリセット・`--primary-strong` 固定値化)+ フォント切替 + ルートレイアウト配線
6. 表示設定画面 + Server Action + ナビ
7. `dashboard.ts` テストファースト
8. ダッシュボード画面 + ミニ集計の警告
9. verify-booking チェックリスト追記・最終検証

各番号の完了時点でコミットする(手順7)。

## 検証方法

- `npm test` / `npm run build` / `npm run lint`
- ブラウザ: 表示設定で3プリセット×2フォントを切り替え、管理画面と客側(`/booking`)の
  両方で色・フォントが変わること。保存前は画面全体が変わらないこと
- ブラウザ: 3プリセットそれぞれで、アウトラインボタン(`--primary-strong` の文字)・
  選択状態・淡色の面(`--accent`)が破綻していないこと(スクショを残す)
- ブラウザ: ダッシュボードの3カード。プッシュ送信数は0件の表示になる
- OSのダーク設定(DevTools の prefers-color-scheme: dark)でも配色が変わらないこと
- verify-booking に追記: スタッフロールで表示設定を開くと弾かれる /
  150通超の警告表示(`push_messages` にテスト行を入れて確認 — リモートDB書き込みなので
  ユーザー作業)/ 客側LIFF実機でテーマ・フォントが反映される

## すり合わせ済みの決定(2026-10-20)

1. **ダークテーマは提供しない(ライトのみ)**。`.dark` ブロックと `dark:` ユーティリティを
   削除し、`color-scheme: light` を指定する。`@custom-variant dark` は残す(理由は
   「決めたいこと」1)
2. **フォントの既定値は LINE Seed JP**(現状維持)。テーマの既定値もモーヴ(現状維持)
3. **ダッシュボードは独立ページ `/admin/dashboard`**。メインナビの「代行登録」の下、
   オーナー・スタッフとも閲覧可。150通超の警告はサイドバーのミニ集計にも出す
