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
- `--accent`(淡色の面)は**モックの accentTint そのもの**(モーヴ #F3EBEA / セージ #EAF1EE /
  スレート #E9F0F2)。当初は現行モーヴの明度・彩度(0.93 / 0.022)を保ち色相だけを替えて
  いたが、セージ・スレートでモックより緑・青が強く出たため揃えた(下記「追加: セージ版
  モックとの照合」)。`--accent-foreground` は明度・彩度(0.38 / 0.035)を揃え色相だけ替える
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

## 追加(2026-10-20): テーマ色の適用範囲をモックに合わせる

実機確認のあと、「表示設定を変えてもボタンと一部の文字しか変わらない」という指摘があった。
モックの引き継ぎ資料 `docs/mockups/README.md` とソース版 `docs/mockups/mock.dc.html` を
確認したところ、**テーマで変わるのが3色(accent / accentDark / accentTint)だけで、
ニュートラルは全テーマ共通**という考え方は実装と同じだった。違いは**適用範囲**で、
モックはこの3色を見出しの文字・淡い面・カレンダーの予約カードにも使っている。

### 方針

- `mock.dc.html` の `var(--accent` / `var(--accent-dark` / `var(--accent-tint` の使用箇所を
  すべて拾い、実装の対応箇所と照合して差分を直す。対応関係は
  accent → `--primary`、accentDark → `--primary-strong`、accentTint → `--accent`
  (面)/ `--accent-foreground`(面の上の文字)。新しいテーマ用トークンは足さない
- README に明記されている例: 客側メニューのカテゴリ見出し(accentDark・13px・太字)/
  日時選択の選択日(accent の塗り)/ 合計・お客様からのご要望(tint の背景)/
  選択中カードの影 `0 2px 6px rgba(accent, 0.12)`
- **意図して変えない**: M1〜M4b でモックと違う形に決めて記録済みのもの(各計画書の
  「すり合わせ済みの決定」「実装中に判明した修正」)。照合で見つけても直さず一覧に残す

### スタッフ色と休憩(決定: 2026-10-20)

README の「スタッフ色: 田中 = accent / 佐藤 = #B7B2A6(背景 #F0EFE9)/ 休憩 #C99A86
(背景 #EFE6E0)」に合わせる。M4 で決めたローズ/アンバー/ブルーの3色循環は置き換える。

| 対象 | 帯・凡例 | 下地 | 備考 |
| --- | --- | --- | --- |
| 1人目のスタッフ(表示順) | `--primary` | `--accent` | テーマに追従する |
| 2人目 | oklch(0.764 0.018 88)(#B7B2A6) | oklch(0.951 0.008 99)(#F0EFE9) | ニュートラル |
| 3人目以降 | 現行の staff-3(ダスティブルー) | 現行の staff-3-surface | 循環させず全員この色(モックに指定なし) |
| 休憩 | oklch(0.725 0.063 44)(#C99A86) | oklch(0.930 0.013 56)(#EFE6E0) | 文字 oklch(0.572 0.075 50.5)(#9C6B4F、下地上で約4.5:1)。新トークン `--break` / `--break-surface` / `--break-foreground` |

- 休憩の下地(0.930 / 56°)は予約不可・定休日の `--secondary`(0.93 / 60°)とほぼ同色に
  なる。モックも同じで、**帯の色・文字ラベル(☕ 休憩 13:00–13:30)・定休日の斜線**で
  区別している。実装でも休憩ブロックには帯と「休憩」ラベルを必ず付け、色だけに頼らない
- `staffColor(index)` の循環(`index % 3`)は「2以上は3人目の色」に変わるので、
  判断ロジックとして `src/lib/` へ移し、特性化テスト → 仕様変更の順で直す

### 照合結果

`mock.dc.html` の `var(--accent,` / `var(--accent-dark` / `var(--accent-tint` の使用箇所
(120か所)を画面・部品ごとにまとめ、実装の対応箇所と照合した。モック列の行番号は
`mock.dc.html` のもの。tint の面の上の accentDark の文字は `text-primary-strong` に
対応させる(`--accent-foreground` はモックの accentDark より暗い)。

| 画面 | 部品 | モック | 実装(修正前) | 対応 |
| --- | --- | --- | --- | --- |
| (モック資料) | 冒頭・各セクションの見出しと注記(37/64/370/791行) | accent の文字 / tint+accentDark | — | 対象外(画面ではなくモック資料の注記) |
| 客1 メニュー選択 | カテゴリ見出し(82〜131行・7か所) | 文字 accentDark・13px・太字 | `text-base font-bold`(文字は既定の foreground) | 修正: `text-primary-strong`。大きさ(16px)は色の範囲外なので変えない |
| 客1 メニュー選択 | 選択中のメニューカード(86/96行) | 枠 2px accent+影 `0 2px 6px rgba(accent,0.12)` | `border-primary`(1px)・影なし | 修正: `--primary` を12%にした影を追加。枠の太さは色の範囲外なので変えない |
| 客1・客2 | 選択中の ✓ 丸(86/96/166行) | 塗り accent | `bg-primary` | 対応済み |
| 客1〜客4 | 下部の主ボタン(141/182/225/256/288行) | 塗り accent | `Button` 既定(`bg-primary`) | 対応済み |
| 客2・客3 | ヘッダーのメニュー要約チップ(157/198行) | tint+accentDark(2つ目以降のチップはニュートラル) | 全チップ `bg-secondary text-secondary-foreground` | 修正: 先頭のチップだけ `bg-accent text-primary-strong` |
| 客2 スタッフ選択 | 選択中のスタッフカード(163行) | 枠 2px accent+影 | `border-primary`(1px)・影なし | 修正: 影を追加(メニューカードと同じ) |
| 客2 スタッフ選択 | 1人目の顔写真枠(164行) | tint+accentDark(2人目・どちらでもは `#f0eee9`) | 写真が無ければ頭文字の丸 `bg-secondary`(全員) | 修正(選択状態に連動。下記の決定) |
| 客3 日時選択 | 選択日(208行) | 塗り accent | `bg-primary` | 対応済み |
| 客3 日時選択 | 選択中の時間ボタン(215行) | 枠・塗り accent | `border-primary bg-primary` | 対応済み |
| 客 初回情報入力 | 案内ボックス(252行) | tint+accentDark | `bg-accent text-accent-foreground` | 修正: 文字のみ `text-primary-strong` |
| 客4 予約確認 | 合計の行(277行) | tint、「合計」と金額は accentDark | `bg-accent text-accent-foreground` | 修正: 文字のみ `text-primary-strong` |
| 客5 予約完了 | ✓ 丸(301行) | 塗り accent | `bg-primary` | 対応済み |
| 客5 予約完了 | 案内ボックス(309行) | tint+accentDark | `bg-accent text-accent-foreground` | 修正: 文字のみ `text-primary-strong` |
| 客5 予約完了 | 「マイ予約を見る」(312行) | 枠 accent・文字 accentDark | `outline-accent` | 対応済み |
| 客7 マイ予約 | ステータスチップ「確定」(330行) | tint+accentDark | `bg-secondary text-secondary-foreground` | 修正: `bg-accent text-primary-strong` |
| A ログイン | 店名(380行) | 文字 accent | `text-primary` | 対応済み |
| A ログイン | ログインボタン(385行) | 塗り accent | `Button` 既定 | 対応済み |
| サイドバー(日・週) | 店名「LUCE 管理」(399/471行) | 文字 accent | `text-primary` | 対応済み |
| サイドバー(日・週) | 選択中のナビ(401/473行) | 塗り accent | `bg-primary` | 対応済み |
| サイドバー(日・週) | ミニ集計のプッシュ使用量バー(413/485行) | 塗り accent | `bg-primary` | 対応済み |
| B カレンダー日 | 「今日」チップ(422行) | tint+accentDark | `border-primary bg-accent text-accent-foreground` | 修正: 文字のみ `text-primary-strong`(枠は「押せる」ことを示すために付けたもので据え置き) |
| B・B-2 | 日/週トグルの選択中(424/495行) | 塗り accent | `bg-primary` | 対応済み |
| B カレンダー日・H スマホ日 | 1人目の予約カード(444〜446/816〜817行) | 下地 tint+左帯 4px accent | `staff-1`(ローズ固定 oklch(0.58 0.09 20)/ 下地 oklch(0.89 0.05 20)) | 修正: スタッフ色の方針どおり `staff-1` = `--primary` / `--accent` |
| B カレンダー日 | 予約カードの料金(445行) | 文字 accentDark(1人目のカード) | `text-xs font-bold`(foreground) | 意図して変えない(下記の決定) |
| B-2 カレンダー週 | 凡例の1人目(493行) | 塗り accent | `bg-staff-1`(ローズ固定) | 修正: スタッフ色の方針どおり |
| B-2 カレンダー週 | 1人目の予約カード(514/518/520/524行) | 下地 tint+左帯 3px accent | `staff-1`(ローズ固定) | 修正: スタッフ色の方針どおり |
| B-2 カレンダー週 | 今日の列の曜日見出し(524行) | 下地 tint | 強調なし | 修正: `bg-accent`(定休日なら `bg-secondary` を優先)+ `aria-current="date"` |
| C 予約詳細 | お客様からのご要望(543行) | 下地 tint・見出し accentDark(本文はニュートラル `#5b6270`) | `bg-accent`、見出し・本文とも `text-accent-foreground` | 修正: 見出しの文字のみ `text-primary-strong`(本文は下記の補足) |
| C 予約詳細 | スタッフメモの「編集」(544行) | 文字 accent | `text-primary` | 対応済み |
| C 予約詳細 | 「変更」(547行) | 塗り accent | `Button` 既定 | 対応済み |
| D 代行登録 | お客様名の検索欄・フォーカス中(564行) | 枠 accent | `focus-visible:border-ring`(`--ring` = `--primary`) | 対応済み |
| D 代行登録 | 候補リストの強調行(566行) | 下地 tint | `hover:bg-muted` | 修正: `hover:bg-accent` |
| D 代行登録 | 空き判定メッセージ(578行) | tint+accentDark | `bg-accent text-accent-foreground` | 修正: 文字のみ `text-primary-strong` |
| D 代行登録 | 「この内容で登録」(583行) | 塗り accent | `Button` 既定 | 対応済み |
| E スタッフ設定 | 勤務曜日チップの選択中(598〜603行) | 塗り accent | `bg-primary` | 対応済み |
| E・E-2 | 「＋ 追加」「＋ 日付を追加」(612/635/656行) | 枠 accent・文字 accentDark | `outline-accent` | 対応済み |
| E-2 定休日・祝日 | 毎週の定休曜日・第N チップの選択中(629/643行) | 塗り accent | `bg-primary` | 対応済み |
| E-2 定休日・祝日 | 第N曜日の定休の説明文(648行) | tint+accentDark | `bg-accent text-accent-foreground` | 修正: 文字のみ `text-primary-strong` |
| E-2 定休日・祝日 | 祝日休業のスイッチ(653行) | 塗り accent | `bg-primary` | 対応済み |
| F メニュー管理 | 「カテゴリを編集」(670行) | 枠 accent・文字 accentDark | `outline-accent` | 対応済み |
| F メニュー管理 | 「＋ 新規メニュー」(670行) | 塗り accent | `Button` 既定 | 対応済み |
| F メニュー管理 | カテゴリの区切り行(675〜710行) | 文字 accentDark(下地はニュートラル `#faf9f6`) | `bg-muted text-muted-foreground` | 修正: 文字のみ `text-primary-strong` |
| F メニュー管理 | 行の「編集」(676〜714行) | 文字 accent | `text-primary` | 対応済み |
| F詳細 カテゴリ編集 | 名称入力・フォーカス中(727行) | 枠 2px accent | `focus-visible:border-ring` | 対応済み |
| F詳細 カテゴリ編集 | 「＋ カテゴリを追加」(733行) | 破線の枠 accent・tint・文字 accentDark | `outline-accent` + `border-dashed bg-accent` | 対応済み |
| F詳細・F-2 | 「保存する」(737/764行) | 塗り accent | `Button` 既定 | 対応済み |
| F-2 表示設定 | 選択中のテーマのカード(752行) | 枠 accent・tint・「採用中」accentDark・✓ 丸 accent | `border-primary bg-accent` / `text-primary-strong` / `bg-primary` | 対応済み |
| F-2 表示設定 | フォントの選択中(760行) | 塗り accent | `border-primary bg-primary` | 対応済み |
| G ダッシュボード | プッシュ使用量バー(780行) | 塗り accent | `bg-primary` | 対応済み |
| H スマホ日 | スタッフ切替の選択中(803行) | 塗り accent | `bg-primary` | 対応済み |
| I スマホリスト | 件数チップ「6件」(830行) | tint+accentDark | — | 実装なし |
| I スマホリスト | 時刻(832〜836行) | 文字 accentDark | `text-primary` | 修正: `text-primary-strong` |
| I スマホリスト | 選択中の予約カード(834行) | 枠 2px accent+影 | — | 実装なし(リストに選択状態が無く、押すと予約詳細が開く) |

集計: 修正 20件 / 対応済み 30件 / 意図して変えない 1件 / 要相談 0件 / 実装なし 2件
(ほかにモック資料の注記が対象外 1件)。各計画書の「すり合わせ済みの決定」「実装中に
判明した修正」に、テーマ色の適用範囲をモックと違う形に決めた記録は無かった。

要相談だった2件(決定: 2026-10-20):

- **客2 の顔写真枠(164行)**: モックは1人目(田中)だけ tint+accentDark で、2人目と
  「どちらでも」はニュートラル。ただし1人目は選択中のカードでもあるため、「選択状態に
  連動する」のか「1人目のスタッフ色」なのかがモックから判別できない。実装は写真が
  無いとき全員 `bg-secondary` の頭文字の丸(写真があれば `<img>`)。
  → **選択状態に連動させる**: 選択中のカードの頭文字の丸(と「どちらでも」の丸)を
  `bg-accent` + `text-primary-strong` にし、未選択は従来の `bg-secondary`。写真は変えない
- **カレンダー日の予約カードの料金(445行)**: モックで料金が出ているのは1人目のカード
  だけで、文字は accentDark。2人目以降の色は指定が無い。案は (a) `staffColor` に強調
  文字のクラスを持たせ、1人目だけ `text-primary-strong`(ほかは foreground)、
  (b) 全員 foreground のまま。
  → **(b) 全員 foreground のまま**。1人目だけ料金の色が違うと、テーマ色が「強調」と
  「スタッフ色」の2つの意味を持ってしまうため

補足:

- **モックに画面が無い同種の面も揃えた**: tint の面の上の文字は `text-primary-strong`
  に統一した。モックに無い案内ボックス(マイ予約のお知らせ、予約カードの「お店に直接
  ご連絡ください」、スタッフ設定の削除不可の案内、メニュー編集の非表示の案内)と、
  臨時休・臨時営業のバッジも `text-accent-foreground` から付け替えた。白地に置いた
  スタッフ設定の「未保存の変更」の文字は tint の面ではないので変えていない
- **逆向きの差(実装がテーマ色・モックはニュートラル)**は照合の対象外としたが、気づいた
  ものを残す: 予約詳細のご要望の本文(モック `#5b6270`、実装 `text-accent-foreground`)、
  客3 の月カレンダーの日曜見出し(モック `#c0503f`、実装 `text-primary/80`)

## 追加(2026-10-20): セージ版モックとの照合

Claude Design からテーマ別に書き出したモック(sage / slate)を受け取ったが、どちらも
**モーヴで描画された**(Tweaks で選んだテーマが書き出しに反映されない)。モックの
テーマ切替は3つのCSS変数(--accent / --accent-dark / --accent-tint)の差し替えだけなので、
ブラウザで変数にセージの値を入れて再現し、実装と照合した。書き出したHTMLはリポジトリに
入れない(`.git/info/exclude` で除外)。モックは `.claude/launch.json` の `mockups`
(python の http.server、127.0.0.1:4100)で開ける。

- 色の当たり方(1人目のスタッフ=テーマ色、2人目=ニュートラル、休憩=茶系の帯、
  ナビの選択中・「今日」・選択中カード・見出しの濃い文字)は一致
- **差分は淡い色(--accent)の濃さだけ**: 実装はモーヴ #F6E3DF / セージ #DAEDE6 /
  スレート #D9EBF3 で、モックの accentTint より濃く鮮やかだった。カレンダーのカードや
  今日の列にも使うようになって面積が増えたため、**3案ともモックの値に揃えた**
  (決定: 2026-10-20)。モーヴも少し淡くなる。1人目の予約カードの下地が休憩・予約不可の
  下地(明度0.93)より明るくなり(0.946〜0.952)、見分けやすさはむしろ上がる

## 追加(2026-10-20): 管理画面のニュートラル(地の色・罫線)をモックに揃える

テーマ別のモックのPNG(`docs/mockups/美容室予約モック-{mauve,sage,slate}.png`。書き出しHTMLと
同じくリポジトリには入れない)を画素で測ったところ、管理画面の地の色がモックと**逆**だった。
前回の照合はテーマ色の使用箇所だけが対象だったため、ニュートラルの差分を拾えていなかった。
これらの値は3テーマ共通で、テーマ切替とは関係ない。

| 場所 | モック | 修正前 | 修正後のトークン |
| --- | --- | --- | --- |
| サイドバーの地(PC幅) | #F4F2EC | #FFFFFF | `--sidebar`(shadcn 既定の未使用トークンを置き換え) |
| サイドバーの右の境界線・ミニ集計カードの枠 | #E6E3DC | `--border` | `--sidebar-border` |
| 予約カレンダーのツールバー・本体 | #FFFFFF | ページ背景 #F6F3EF が透けていた | `bg-card` |
| カレンダーの列見出し | #FAF9F6 | ページ背景 | `--calendar-header`(新規) |
| カレンダーの区切り線(ツールバー・見出しの下、列の間、時刻列の右) | #ECEAE4 | `--border` #E3DDD8 | `--calendar-divider`(新規) |
| 時間の罫線 | #F2F0EA | `--border` #E3DDD8 | `--grid-line`(新規) |

- 白い地はモックがサイドバー付きの枠で描いている**予約カレンダー(日・週・スマホの日表示)だけ**。
  設定・ダッシュボード・代行登録はモックで単独のカードとして描かれているので、従来どおり
  ページ背景 + 白いカード。スマホのリスト表示はモックIどおりページ背景のまま
- スマホ幅のヘッダーバーと展開メニューはモックに描かれていないので白のまま
- 週表示の列見出しの地は「定休日 → `bg-secondary`、今日 → `bg-accent`、それ以外 →
  `bg-calendar-header`」の排他。M4b の定休日・営業時間外の帯・予約不可の斜線・休憩は、
  白地になって周囲との明度差がむしろ大きくなる

### 文字色は変えない(決定: 2026-10-20)

モックの文字色は青みのグレー(README: 本文 #1F2430 / secondary #5B6270 / muted #7B818D /
subtle #9AA0AB)で、実装は赤みの焦げ茶(本文 #2E2725 / 補足 `--muted-foreground` #716662)と
系統が違う。**モックには揃えない**。

- モックの muted #7B818D は白地で 3.91:1、subtle #9AA0AB は 2.63:1 で、WCAG AA(4.5:1)に
  届かない。サイドバーの地 #F4F2EC の上ではさらに下がる(3.50:1 / 2.35:1)
- 客層は40代以上中心で、ADR-006 は読みやすさを最優先にしている。実装の補足文字は白地で
  5.56:1、サイドバーの地の上でも 4.96:1 を保つ
- 色相(青み/赤み)だけを寄せる案もあるが、明度を保っても印象が大きく変わる割に利点が
  小さいので見送る。必要になったら別途検討する
