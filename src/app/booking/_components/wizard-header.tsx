// ウィザード上部の共通ヘッダー(STEP表示・タイトル・選択済みチップ)。表示のみ。

import { cn } from "@/lib/utils";

const TOTAL_STEPS = 4;

type Props = {
  /** ステップ番号(1〜4)。初回情報入力はステップ数に含めないため省略する */
  step?: number;
  title: string;
  subtitle?: string;
  /** 選択済みの内容(メニュー要約・スタッフ・日時)のチップ */
  chips?: string[];
};

export function WizardHeader({ step, title, subtitle, chips }: Props) {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-card px-4 pb-3 pt-4">
      {step !== undefined && (
        <p className="text-sm font-bold tracking-widest text-muted-foreground">
          STEP {step} / {TOTAL_STEPS}
        </p>
      )}
      <h1 className="mt-1 text-2xl font-bold">{title}</h1>
      {subtitle !== undefined && (
        <p className="mt-1 text-base text-muted-foreground">{subtitle}</p>
      )}
      {chips !== undefined && chips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {chips.map((chip, index) => (
            <span
              key={chip}
              className={cn(
                "rounded-full px-3 py-1 text-sm",
                // 先頭(メニュー要約)だけテーマの淡色の面+濃い側の文字。
                // 2つ目以降(料金・スタッフ・日時)はニュートラル(モック準拠)
                index === 0
                  ? "bg-accent text-primary-strong"
                  : "bg-secondary text-secondary-foreground",
              )}
            >
              {chip}
            </span>
          ))}
        </div>
      )}
    </header>
  );
}
