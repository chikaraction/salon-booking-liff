"use client";

// カテゴリの編集ダイアログ(モックF詳細)。配線に徹する:
// 行の差分計算・削除の可否判定・入力の検証は src/lib/menu-settings.ts の
// 純粋関数が担い、ここは状態とServer Actionの呼び出しだけ。
//
// 追加・名称変更・削除・並べ替えを画面上でまとめて編集し、「保存する」で確定する
// (どの行をinsert/update/deleteするかはサーバー側で現在値と突き合わせて決める)。

import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Loader2, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { saveMenuCategories } from "@/app/admin/(protected)/settings/actions";
import { Button } from "@/components/ui/button";
import {
  findCategoryDeleteViolation,
  toCategoryDrafts,
  validateCategoryDrafts,
  type CategoryDraft,
  type MenuCategoryRecord,
} from "@/lib/menu-settings";
import { cn } from "@/lib/utils";

import {
  sortableAnnouncements,
  sortableScreenReaderInstructions,
  useSortableSensors,
} from "./sortable";

type Props = {
  categories: MenuCategoryRecord[];
  /** カテゴリID → 所属メニュー数(非表示のメニューも含む) */
  menuCounts: Record<string, number>;
  onClose: () => void;
};

export function CategoryEditDialog({ categories, menuCounts, onClose }: Props) {
  const router = useRouter();
  const sensors = useSortableSensors();

  const [drafts, setDrafts] = useState<CategoryDraft[]>(() =>
    toCategoryDrafts(categories),
  );
  // 新規行のキーの採番。IDがまだ無い行を区別するためだけのもの
  const [nextKey, setNextKey] = useState(1);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over === null || active.id === over.id) return;
    const keys = drafts.map((draft) => draft.key);
    const from = keys.indexOf(String(active.id));
    const to = keys.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    setMessage(null);
    setDrafts((current) => arrayMove(current, from, to));
  };

  const handleRemove = (draft: CategoryDraft) => {
    setMessage(null);
    // 所属メニューが残っているカテゴリは消せない(menus.category_id は NOT NULL)。
    // サーバーでも同じ判定をするが、押した場所で理由が分かるようここでも出す
    if (draft.id !== null) {
      const violation = findCategoryDeleteViolation({
        deleteIds: [draft.id],
        categories,
        menuCounts,
      });
      if (violation !== null) {
        setMessage(violation);
        return;
      }
    }
    setDrafts((current) => current.filter((row) => row.key !== draft.key));
  };

  const handleAdd = () => {
    setMessage(null);
    setDrafts((current) => [
      ...current,
      { key: `new-${nextKey}`, id: null, name: "" },
    ]);
    setNextKey((current) => current + 1);
  };

  const handleSave = () => {
    setMessage(null);
    const validated = validateCategoryDrafts(drafts);
    if (!validated.ok) {
      setErrors(validated.errors);
      setMessage(validated.message);
      return;
    }
    setErrors({});
    startTransition(async () => {
      const result = await saveMenuCategories(drafts);
      if (result.ok) {
        onClose();
        router.refresh();
        return;
      }
      // 「所属メニューがあるカテゴリは削除できない」もここに出る
      setMessage(result.message);
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="category-edit-title"
    >
      {/* 背景(クリックで閉じる) */}
      <button
        type="button"
        aria-label="閉じる"
        className="absolute inset-0 bg-black/40 animate-in fade-in"
        onClick={onClose}
      />

      <div className="relative z-10 flex max-h-[90dvh] w-full max-w-lg flex-col rounded-2xl bg-card shadow-lg animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-start justify-between gap-3 border-b border-border p-6">
          <div>
            <h2
              id="category-edit-title"
              className="text-xl font-bold text-foreground"
            >
              カテゴリの編集
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              ドラッグで並べ替え・名称変更・追加ができます
            </p>
          </div>
          <button
            type="button"
            aria-label="閉じる"
            onClick={onClose}
            // ホバーは bg-input にする。bg-secondary は bg-muted と明度差が
            // ほぼ無く(ダークでは同値)、ホバーしたことが分からなかった
            className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-colors hover:bg-input hover:text-foreground"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {drafts.length === 0 ? (
            <p className="text-base text-muted-foreground">
              カテゴリがありません。「カテゴリを追加」から登録してください。
            </p>
          ) : (
            <DndContext
              // IDを明示してハイドレーションのずれを避ける(menu-settings-form
              // と同じ理由。省略すると採番の連番が描画ごとに変わる)
              id="category-sort"
              sensors={sensors}
              collisionDetection={closestCenter}
              accessibility={{
                screenReaderInstructions: sortableScreenReaderInstructions,
                announcements: sortableAnnouncements(
                  (key) =>
                    drafts.find((draft) => draft.key === key)?.name ??
                    "新しいカテゴリ",
                ),
              }}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={drafts.map((draft) => draft.key)}
                strategy={verticalListSortingStrategy}
              >
                <ul className="flex flex-col gap-3">
                  {drafts.map((draft) => (
                    <CategoryRow
                      key={draft.key}
                      draft={draft}
                      error={errors[draft.key]}
                      onChange={(name) => {
                        setMessage(null);
                        setDrafts((current) =>
                          current.map((row) =>
                            row.key === draft.key ? { ...row, name } : row,
                          ),
                        );
                      }}
                      onRemove={() => handleRemove(draft)}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          )}

          <Button
            type="button"
            variant="outline"
            onClick={handleAdd}
            className="mt-4 h-11 rounded-xl px-4 text-base"
          >
            <Plus aria-hidden="true" className="size-4" />
            カテゴリを追加
          </Button>

          <p className="mt-4 text-sm text-muted-foreground">
            メニューが登録されているカテゴリは削除できません。先にそのメニューのカテゴリを変更してください。
          </p>

          {message !== null && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {message}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border p-6">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            className="h-11 rounded-xl px-5 text-base"
          >
            キャンセル
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={isPending}
            className="h-11 rounded-xl px-5 text-base"
          >
            {isPending && (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            )}
            保存する
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1行(ドラッグハンドル + テキスト入力 + 削除)
// ---------------------------------------------------------------------------

function CategoryRow({
  draft,
  error,
  onChange,
  onRemove,
}: {
  draft: CategoryDraft;
  error: string | undefined;
  onChange: (name: string) => void;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: draft.key });

  const label = draft.name === "" ? "新しいカテゴリ" : draft.name;

  return (
    <li
      ref={setNodeRef}
      style={{
        // 縦一列の並べ替えなので横方向のずれ(x)は捨てる
        transform: CSS.Translate.toString(
          transform === null ? null : { ...transform, x: 0 },
        ),
        transition,
      }}
      className={cn(
        "flex flex-col gap-1",
        isDragging && "relative z-10 opacity-90",
      )}
    >
      <div className="flex items-center gap-2">
        {/* 掴む場所。タッチでのスクロールと取り合わないよう touch-none にする */}
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          className="flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none active:cursor-grabbing"
        >
          <GripVertical aria-hidden="true" className="size-4" />
          <span className="sr-only">{label}の表示順を変更</span>
        </button>

        <label className="sr-only" htmlFor={`category-name-${draft.key}`}>
          カテゴリ名
        </label>
        <input
          id={`category-name-${draft.key}`}
          type="text"
          value={draft.name}
          onChange={(event) => onChange(event.target.value)}
          className="h-11 min-w-0 flex-1 rounded-xl border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
        />

        <button
          type="button"
          aria-label={`${label}を削除`}
          onClick={onRemove}
          className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive transition-colors hover:bg-destructive/20"
        >
          <X aria-hidden="true" className="size-5" />
        </button>
      </div>
      {error !== undefined && (
        <p role="alert" className="pl-10 text-sm text-destructive">
          {error}
        </p>
      )}
    </li>
  );
}
