// 表示設定(/admin/settings/display)の判断ロジック(純粋関数)。
// UI・Server Action・ルートレイアウトは配線に徹し、判断はここへ押し戻す(CLAUDE.md)。
// DOM・Supabaseクライアントのimportはしない。
//
// 扱うのは salon_settings(単一行)のうち次の2列:
//   1. theme_preset … テーマカラーのプリセットID(sage / mauve / slate)
//   2. font_family  … フォントID(noto_sans_jp / line_seed_jp)
//
// DBが持つのは色そのものではなくIDで、色の定義は globals.css だけに置く
// (ADR-006「トークンは1ファイル」)。IDの集合はDBの check 制約
// (supabase/migrations/20261020000000_m4c_display_settings.sql)と一致させる。
// 候補の表示名・一言はどの店でも同じUI文字列であり、店舗固有値ではない(ADR-007)。

// ---------------------------------------------------------------------------
// 1. 候補
// ---------------------------------------------------------------------------

/** テーマカラーのプリセット(モックF-2の並び順) */
export const THEME_PRESETS = [
  { id: "sage", label: "A. セージグリーン", note: "自然体・清潔感" },
  { id: "mauve", label: "B. モーヴ", note: "上品・温かみ" },
  { id: "slate", label: "C. スレートブルー", note: "落ち着き・信頼感" },
] as const satisfies readonly { id: string; label: string; note: string }[];

export type ThemePresetId = (typeof THEME_PRESETS)[number]["id"];

/** フォントの選択肢(モックF-2のセグメントの並び順) */
export const FONT_OPTIONS = [
  { id: "noto_sans_jp", label: "Noto Sans JP" },
  { id: "line_seed_jp", label: "LINE Seed JP" },
] as const satisfies readonly { id: string; label: string }[];

export type FontFamilyId = (typeof FONT_OPTIONS)[number]["id"];

/** 検証済みの表示設定 */
export type DisplaySettings = {
  themePreset: ThemePresetId;
  fontFamily: FontFamilyId;
};

/**
 * 既定値。マイグレーションの列の既定値(theme_preset='mauve' /
 * font_family='line_seed_jp')と一致させる。M4b までの見た目(テーマB モーヴ +
 * LINE Seed JP)で、取得失敗・想定外の値のときもこれで描画する。
 */
export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  themePreset: "mauve",
  fontFamily: "line_seed_jp",
};

function isThemePresetId(value: unknown): value is ThemePresetId {
  return THEME_PRESETS.some((preset) => preset.id === value);
}

function isFontFamilyId(value: unknown): value is FontFamilyId {
  return FONT_OPTIONS.some((option) => option.id === value);
}

// ---------------------------------------------------------------------------
// 2. DBの値の解決(ルートレイアウト用)
// ---------------------------------------------------------------------------

/** salon_settings から読む表示用の2列(取得失敗なら null) */
export type DisplaySettingsRow = {
  theme_preset: unknown;
  font_family: unknown;
};

/**
 * DBの値を表示設定にする。例外にはしない。
 * - null(取得失敗)は既定値。配色のせいで予約画面ごと落ちるのは割に合わない
 * - 未知の値は項目ごとに既定値へ倒す(テーマだけ不正ならフォントは生かす)。
 *   列の check 制約があるので通常は起きない
 */
export function resolveDisplaySettings(
  row: DisplaySettingsRow | null,
): DisplaySettings {
  if (row === null) return DEFAULT_DISPLAY_SETTINGS;
  return {
    themePreset: isThemePresetId(row.theme_preset)
      ? row.theme_preset
      : DEFAULT_DISPLAY_SETTINGS.themePreset,
    fontFamily: isFontFamilyId(row.font_family)
      ? row.font_family
      : DEFAULT_DISPLAY_SETTINGS.fontFamily,
  };
}

// ---------------------------------------------------------------------------
// 3. 入力の検証(Server Action 用)
// ---------------------------------------------------------------------------

/** テーマカラーが候補外のときの文言 */
export const THEME_PRESET_INVALID_MESSAGE =
  "テーマカラーの選択が正しくありません";

/** フォントが候補外のときの文言 */
export const FONT_FAMILY_INVALID_MESSAGE = "フォントの選択が正しくありません";

/** フォームの入力値(ラジオ・セグメントの生の値) */
export type DisplaySettingsInput = {
  themePreset: string;
  fontFamily: string;
};

export type DisplaySettingsResult =
  { ok: true; value: DisplaySettings } | { ok: false; message: string };

/**
 * 表示設定の入力を検証する。DBの check 制約と同じ集合を先出しし、
 * 候補外のIDは拒否する(既定値に倒さない。保存は利用者の明示的な操作なので)。
 * 両方とも不正ならテーマの誤りを先に返す(画面の並び順)。
 */
export function validateDisplaySettingsInput(
  input: DisplaySettingsInput,
): DisplaySettingsResult {
  if (!isThemePresetId(input.themePreset)) {
    return { ok: false, message: THEME_PRESET_INVALID_MESSAGE };
  }
  if (!isFontFamilyId(input.fontFamily)) {
    return { ok: false, message: FONT_FAMILY_INVALID_MESSAGE };
  }
  return {
    ok: true,
    value: { themePreset: input.themePreset, fontFamily: input.fontFamily },
  };
}
