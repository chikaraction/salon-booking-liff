import { describe, expect, it } from "vitest";

import {
  DEFAULT_DISPLAY_SETTINGS,
  FONT_FAMILY_INVALID_MESSAGE,
  FONT_OPTIONS,
  THEME_PRESET_INVALID_MESSAGE,
  THEME_PRESETS,
  isDisplaySettingsChanged,
  resolveDisplaySettings,
  validateDisplaySettingsInput,
} from "./display-settings";

describe("THEME_PRESETS", () => {
  it("モックF-2の並び(A セージグリーン → B モーヴ → C スレートブルー)で3案を持つ", () => {
    expect(THEME_PRESETS).toEqual([
      { id: "sage", label: "A. セージグリーン", note: "自然体・清潔感" },
      { id: "mauve", label: "B. モーヴ", note: "上品・温かみ" },
      { id: "slate", label: "C. スレートブルー", note: "落ち着き・信頼感" },
    ]);
  });
});

describe("FONT_OPTIONS", () => {
  it("Noto Sans JP と LINE Seed JP の2択をこの順で持つ", () => {
    expect(FONT_OPTIONS).toEqual([
      { id: "noto_sans_jp", label: "Noto Sans JP" },
      { id: "line_seed_jp", label: "LINE Seed JP" },
    ]);
  });
});

describe("DEFAULT_DISPLAY_SETTINGS", () => {
  it("既定値はモーヴ + LINE Seed JP(マイグレーションの列の既定値と同じ)", () => {
    expect(DEFAULT_DISPLAY_SETTINGS).toEqual({
      themePreset: "mauve",
      fontFamily: "line_seed_jp",
    });
  });
});

describe("resolveDisplaySettings", () => {
  it("DBの値をそのまま表示設定に変換する", () => {
    expect(
      resolveDisplaySettings({
        theme_preset: "slate",
        font_family: "noto_sans_jp",
      }),
    ).toEqual({ themePreset: "slate", fontFamily: "noto_sans_jp" });
  });

  it("すべてのプリセットIDとフォントIDを受け付ける", () => {
    for (const theme of THEME_PRESETS) {
      for (const font of FONT_OPTIONS) {
        expect(
          resolveDisplaySettings({
            theme_preset: theme.id,
            font_family: font.id,
          }),
        ).toEqual({ themePreset: theme.id, fontFamily: font.id });
      }
    }
  });

  it("取得に失敗した(null)ときは既定値で描画する", () => {
    expect(resolveDisplaySettings(null)).toEqual(DEFAULT_DISPLAY_SETTINGS);
  });

  it("テーマだけ未知の値なら、テーマは既定値に倒しフォントは生かす", () => {
    expect(
      resolveDisplaySettings({
        theme_preset: "crimson",
        font_family: "noto_sans_jp",
      }),
    ).toEqual({ themePreset: "mauve", fontFamily: "noto_sans_jp" });
  });

  it("フォントだけ未知の値なら、フォントは既定値に倒しテーマは生かす", () => {
    expect(
      resolveDisplaySettings({
        theme_preset: "sage",
        font_family: "comic_sans",
      }),
    ).toEqual({ themePreset: "sage", fontFamily: "line_seed_jp" });
  });

  it("文字列でない値(null・数値など)も未知の値として既定値に倒す", () => {
    expect(
      resolveDisplaySettings({ theme_preset: null, font_family: 1 }),
    ).toEqual(DEFAULT_DISPLAY_SETTINGS);
  });

  it("大文字違い・前後の空白つきは別の値として扱い、既定値に倒す", () => {
    expect(
      resolveDisplaySettings({
        theme_preset: "Sage",
        font_family: " noto_sans_jp",
      }),
    ).toEqual(DEFAULT_DISPLAY_SETTINGS);
  });
});

describe("validateDisplaySettingsInput", () => {
  it("既知のIDの組み合わせなら検証済みの値を返す", () => {
    expect(
      validateDisplaySettingsInput({
        themePreset: "sage",
        fontFamily: "noto_sans_jp",
      }),
    ).toEqual({
      ok: true,
      value: { themePreset: "sage", fontFamily: "noto_sans_jp" },
    });
  });

  it("未知のテーマIDは拒否する", () => {
    expect(
      validateDisplaySettingsInput({
        themePreset: "custom",
        fontFamily: "line_seed_jp",
      }),
    ).toEqual({ ok: false, message: THEME_PRESET_INVALID_MESSAGE });
  });

  it("未知のフォントIDは拒否する", () => {
    expect(
      validateDisplaySettingsInput({ themePreset: "mauve", fontFamily: "" }),
    ).toEqual({ ok: false, message: FONT_FAMILY_INVALID_MESSAGE });
  });

  it("テーマとフォントの両方が不正なら、先にテーマの誤りを返す", () => {
    // 2つの文言が同じだと、どちらの誤りが先に返ったかを区別できないまま通ってしまう
    expect(THEME_PRESET_INVALID_MESSAGE).not.toBe(FONT_FAMILY_INVALID_MESSAGE);
    expect(
      validateDisplaySettingsInput({ themePreset: "x", fontFamily: "y" }),
    ).toEqual({ ok: false, message: THEME_PRESET_INVALID_MESSAGE });
  });
});

describe("isDisplaySettingsChanged", () => {
  it("テーマもフォントも同じなら変更なし", () => {
    expect(
      isDisplaySettingsChanged(
        { themePreset: "sage", fontFamily: "noto_sans_jp" },
        { themePreset: "sage", fontFamily: "noto_sans_jp" },
      ),
    ).toBe(false);
  });

  it("テーマだけ違えば変更あり", () => {
    expect(
      isDisplaySettingsChanged(DEFAULT_DISPLAY_SETTINGS, {
        ...DEFAULT_DISPLAY_SETTINGS,
        themePreset: "slate",
      }),
    ).toBe(true);
  });

  it("フォントだけ違えば変更あり", () => {
    expect(
      isDisplaySettingsChanged(DEFAULT_DISPLAY_SETTINGS, {
        ...DEFAULT_DISPLAY_SETTINGS,
        fontFamily: "noto_sans_jp",
      }),
    ).toBe(true);
  });
});
