"use client";

// 表示設定のフォーム(モックF-2)。
// 配線に徹する: 候補・入力の検証・変更の有無の判定は src/lib/display-settings.ts の
// 純粋関数が担い、ここは状態とServer Actionの呼び出しだけ。
//
// 色見本・選択スタイルはカードごとに data-theme で囲み、globals.css のトークン
// (bg-primary など)をそのまま使う。色の値をTS側に持たない(ADR-006)。
// フォントのボタンも同様に data-font で囲み、そのフォント自身で描く(プレビュー)。
// 保存するまでは画面全体(<html data-theme>)は変えない。
//
// 選択は native の radio(視覚的に隠す)+ label で作り、キーボード操作
// (矢印キーで選択の移動)と読み上げ(グループ名・選択状態)をブラウザに任せる。

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { saveDisplaySettings } from "@/app/admin/(protected)/settings/actions";
import {
  SectionFooter,
  UnsavedBadge,
  useSavedDraft,
} from "@/app/admin/(protected)/settings/_components/unsaved-changes";
import {
  FONT_OPTIONS,
  THEME_PRESETS,
  isDisplaySettingsChanged,
  validateDisplaySettingsInput,
  type DisplaySettings,
} from "@/lib/display-settings";
import { cn } from "@/lib/utils";

const legendClass = "mb-3 text-base font-bold text-muted-foreground";

/** カスタム色の注記(無効のカードから aria-describedby で参照する) */
const CUSTOM_NOTE_ID = "display-settings-custom-note";

type Props = {
  /** 保存済みの表示設定(salon_settings.theme_preset / font_family) */
  settings: DisplaySettings;
};

export function DisplaySettingsForm({ settings }: Props) {
  const router = useRouter();
  // 保存済みの値(props)が基準
  const { base, draft, setDraft, revert, markSaved } =
    useSavedDraft<DisplaySettings>(
      settings,
      (a, b) => !isDisplaySettingsChanged(a, b),
    );
  const isDirty = isDisplaySettingsChanged(base, draft);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const update = (patch: Partial<DisplaySettings>) => {
    setSaved(false);
    setMessage(null);
    setDraft((current) => ({ ...current, ...patch }));
  };

  const handleRevert = () => {
    setMessage(null);
    setSaved(false);
    revert();
  };

  const handleSave = () => {
    setMessage(null);
    setSaved(false);
    const validated = validateDisplaySettingsInput(draft);
    if (!validated.ok) {
      setMessage(validated.message);
      return;
    }
    startTransition(async () => {
      const result = await saveDisplaySettings(draft);
      if (result.ok) {
        setSaved(true);
        // 保存した値が新しい基準になる(= 変更なしの状態に戻る)
        markSaved();
        // ルートレイアウトの <html data-theme / data-font> を描き直す
        router.refresh();
        return;
      }
      setMessage(result.message);
    });
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 md:px-8 md:py-10">
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="border-b border-border p-6 md:p-8">
          <h1 className="text-2xl font-bold text-foreground">表示設定</h1>
          <p className="mt-2 text-base text-muted-foreground">
            お客様画面・管理画面の配色とフォントを設定します
          </p>
        </div>
        <section className="flex flex-col gap-8 p-6 md:p-8">
          {isDirty && (
            <div className="flex flex-wrap items-center gap-2">
              <UnsavedBadge />
            </div>
          )}

          <fieldset>
            <legend className={legendClass}>テーマカラー</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {THEME_PRESETS.map((preset) => {
                const selected = draft.themePreset === preset.id;
                // 「採用中」は保存済みの値のカードに出す(選択中=未保存と区別する)
                const adopted = base.themePreset === preset.id;
                return (
                  <label
                    key={preset.id}
                    data-theme={preset.id}
                    className={cn(
                      "relative flex cursor-pointer items-center gap-4 rounded-xl border-2 p-4 transition-colors has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                      selected
                        ? "border-primary bg-accent"
                        : "border-border bg-card hover:bg-muted",
                    )}
                  >
                    <input
                      type="radio"
                      name="theme-preset"
                      value={preset.id}
                      checked={selected}
                      onChange={() => update({ themePreset: preset.id })}
                      className="sr-only"
                    />
                    <span
                      aria-hidden="true"
                      className="size-[34px] shrink-0 rounded-full bg-primary"
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="text-base font-bold text-foreground">
                        {preset.label}
                      </span>
                      {adopted ? (
                        <span className="text-sm font-bold text-primary-strong">
                          採用中
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          {preset.note}
                        </span>
                      )}
                    </span>
                    {selected && (
                      <span
                        aria-hidden="true"
                        className="absolute top-3 right-3 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground"
                      >
                        <Check className="size-4" />
                      </span>
                    )}
                  </label>
                );
              })}

              {/* カスタム色は将来対応(M4計画の決定)。選べないカードとして出し、
                  radio も disabled にして読み上げでも選択できないことを伝える */}
              <label className="flex cursor-not-allowed items-center gap-4 rounded-xl border-2 border-dashed border-border bg-card p-4 opacity-60">
                <input
                  type="radio"
                  name="theme-preset"
                  value="custom"
                  disabled
                  aria-describedby={CUSTOM_NOTE_ID}
                  className="sr-only"
                />
                {/* 装飾の色見本。新しいトークンは足さず、既存の色(テーマ色・
                    3人目のスタッフ色・休憩色)で描く */}
                <span
                  aria-hidden="true"
                  className="size-[34px] shrink-0 rounded-full bg-[conic-gradient(var(--primary),var(--staff-3),var(--break),var(--primary))]"
                />
                <span className="flex min-w-0 flex-col">
                  <span className="text-base font-bold text-foreground">
                    ＋ カスタム
                  </span>
                  <span className="text-sm text-muted-foreground">
                    好きな色を指定
                  </span>
                </span>
              </label>
            </div>
            <p
              id={CUSTOM_NOTE_ID}
              className="mt-3 text-sm text-muted-foreground"
            >
              カスタム色は今後対応予定です。
            </p>
          </fieldset>

          <fieldset>
            <legend className={legendClass}>フォント</legend>
            <div className="flex">
              {FONT_OPTIONS.map((option, index) => {
                const selected = draft.fontFamily === option.id;
                return (
                  <label
                    key={option.id}
                    // data-font で --font-app を差し替え、font-sans で
                    // font-family を取り直す(body から継承した値のままだと
                    // 変数を差し替えても書体が変わらないため)
                    data-font={option.id}
                    // スマホ幅では2つを均等幅にして文字を折り返さない
                    // (375px幅で各約147px、太字16pxの「LINE Seed JP」は約113px)。
                    // sm 以上は内容幅 + 広めの余白
                    className={cn(
                      "relative flex h-12 flex-1 cursor-pointer items-center justify-center border-[1.5px] px-3 font-sans text-base font-bold whitespace-nowrap transition-colors has-focus-visible:z-10 has-focus-visible:ring-3 has-focus-visible:ring-ring/50 sm:flex-none sm:px-8",
                      index === 0 ? "rounded-l-xl" : "-ml-[1.5px]",
                      index === FONT_OPTIONS.length - 1 && "rounded-r-xl",
                      selected
                        ? "z-[1] border-primary bg-primary text-primary-foreground"
                        : "border-input bg-card text-muted-foreground hover:bg-muted",
                    )}
                  >
                    <input
                      type="radio"
                      name="font-family"
                      value={option.id}
                      checked={selected}
                      onChange={() => update({ fontFamily: option.id })}
                      className="sr-only"
                    />
                    {option.label}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <SectionFooter
            isPending={isPending}
            isDirty={isDirty}
            message={message}
            saved={saved}
            onSave={handleSave}
            onRevert={handleRevert}
          />
        </section>
      </div>
    </div>
  );
}
