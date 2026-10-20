// STEP 1: メニュー選択。カテゴリ別のカード一覧と選択チェック(複数選択可)。表示のみ。

import { Check } from "lucide-react";

import { formatYen, type MenuCategoryGroup } from "@/lib/booking";
import { cn } from "@/lib/utils";

type Props = {
  categories: MenuCategoryGroup[];
  selectedMenuIds: string[];
  onToggle: (menuId: string) => void;
};

export function StepMenu({ categories, selectedMenuIds, onToggle }: Props) {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">※ 表示価格は税込です</p>
      {categories.map((category) => (
        <section key={category.id}>
          {/* カテゴリ見出しはテーマ色の濃い側(モック: accentDark・太字) */}
          <h2 className="text-base font-bold text-primary-strong">
            {category.name}
          </h2>
          {category.description !== null && (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {category.description}
            </p>
          )}
          <div className="mt-2 flex flex-col gap-3">
            {category.menus.map((menu) => {
              const selected = selectedMenuIds.includes(menu.id);
              return (
                <button
                  key={menu.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onToggle(menu.id)}
                  className={cn(
                    "flex min-h-20 w-full items-center gap-3 rounded-xl border bg-card p-4 text-left transition-colors",
                    // 選択中はテーマ色の枠+テーマ色を12%にした淡い影(モック:
                    // 0 2px 6px rgba(accent, 0.12))。影も --primary に追従させる
                    selected
                      ? "border-primary shadow-[0_2px_6px_color-mix(in_oklab,var(--primary)_12%,transparent)]"
                      : "border-border",
                  )}
                >
                  <span className="flex-1">
                    <span className="block text-base font-bold">
                      {menu.name}
                    </span>
                    <span className="mt-1 block text-sm text-muted-foreground">
                      約{menu.durationMinutes}分
                    </span>
                  </span>
                  <span className="text-lg font-bold">
                    {formatYen(menu.price)}
                  </span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-full border",
                      // 未選択の空丸の枠はモック(#d5d2ca)どおり入力欄と同じ --input
                      selected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-card",
                    )}
                  >
                    {selected && <Check className="size-4" strokeWidth={3} />}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
