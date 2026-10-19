"use client";

// メニュー管理(モックF)。配線に徹する:
// 並べ替えの再採番・入力の検証・表示の整形は src/lib/menu-settings.ts の
// 純粋関数が担い、ここは状態とServer Actionの呼び出しだけ。
//
// 並べ替えは**カテゴリ内に限定**する(カテゴリの変更はメニュー編集ダイアログ)。
// そのためカテゴリごとに DndContext + SortableContext を1つずつ置き、
// 別カテゴリの行へはドロップできないようにしている。

import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useState, useTransition } from "react";

import {
  saveMenu,
  saveMenuOrder,
} from "@/app/admin/(protected)/settings/actions";
import { Button } from "@/components/ui/button";
import {
  MENU_HIDE_INSTEAD_OF_DELETE_LINES,
  formatMenuDuration,
  formatMenuPrice,
  validateMenuInput,
  type MenuAdminGroup,
  type MenuCategoryRecord,
  type MenuErrors,
  type MenuInput,
  type MenuRecord,
} from "@/lib/menu-settings";
import { cn } from "@/lib/utils";

import { CategoryEditDialog } from "./category-edit-dialog";
import {
  sortableAnnouncements,
  sortableScreenReaderInstructions,
  useSortableSensors,
} from "./sortable";

const inputClass =
  "h-11 rounded-xl border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50";
const fieldLabelClass = "text-sm font-bold text-foreground";

/** 一覧の行の列割り(PC幅)。列見出しと行で同じ指定を使って縦を揃える */
const rowGridClass =
  "md:grid md:grid-cols-[1.5rem_1fr_7rem_6rem_3.5rem] md:items-center md:gap-3";

type Props = {
  /** カテゴリ(表示順)と、その下に並ぶメニュー(表示順) */
  groups: MenuAdminGroup[];
  /** カテゴリID → 所属メニュー数。カテゴリ削除の可否判定に使う(非表示も数える) */
  menuCounts: Record<string, number>;
};

export function MenuSettingsForm({ groups, menuCounts }: Props) {
  // ドラッグ直後の並び(カテゴリID → メニューIDの並び)。保存が通るまでの
  // 見た目を先に動かすための上書きで、サーバーから新しい groups が届いたら捨てる
  // (propsの変化に合わせて描画中に状態を捨てるReactの作法)
  const [order, setOrder] = useState<Record<string, string[]>>({});
  const [renderedGroups, setRenderedGroups] = useState(groups);
  if (renderedGroups !== groups) {
    setRenderedGroups(groups);
    setOrder({});
  }

  const [editing, setEditing] = useState<{ menu: MenuRecord | null } | null>(
    null,
  );
  const [isCategoryOpen, setIsCategoryOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const categories: MenuCategoryRecord[] = groups.map((group) => ({
    id: group.id,
    name: group.name,
    description: group.description,
    displayOrder: group.displayOrder,
  }));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 md:px-8 md:py-10">
      <div className="overflow-hidden rounded-2xl bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 p-6 pb-4 md:p-8 md:pb-4">
          <h1 className="text-2xl font-bold text-foreground">メニュー管理</h1>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline-accent"
              onClick={() => {
                setMessage(null);
                setIsCategoryOpen(true);
              }}
              className="h-11 rounded-xl px-4 text-base"
            >
              カテゴリを編集
            </Button>
            <Button
              type="button"
              disabled={categories.length === 0}
              onClick={() => {
                setMessage(null);
                setEditing({ menu: null });
              }}
              className="h-11 rounded-xl px-4 text-base"
            >
              <Plus aria-hidden="true" className="size-4" />
              新規メニュー
            </Button>
          </div>
        </div>

        <p className="px-6 pb-4 text-sm text-muted-foreground md:px-8">
          <GripVertical
            aria-hidden="true"
            className="mr-1 inline size-4 align-text-bottom"
          />
          を掴んで行をドラッグすると表示順を変更できます(ハンドルにフォーカスしてスペースキーでも操作できます)
        </p>

        {message !== null && (
          <p
            role="alert"
            className="px-6 pb-4 text-sm text-destructive md:px-8"
          >
            {message}
          </p>
        )}

        {categories.length === 0 ? (
          <p className="px-6 pb-8 text-base text-muted-foreground md:px-8">
            カテゴリがまだありません。「カテゴリを編集」からカテゴリを追加すると、メニューを登録できます。
          </p>
        ) : (
          <>
            {/* 列見出し(PC幅のみ。スマホ幅は行の中に料金・所要時間を畳む) */}
            <div
              aria-hidden="true"
              className={cn(
                "hidden px-8 pb-2 text-sm text-muted-foreground",
                rowGridClass,
              )}
            >
              <span />
              <span>メニュー名</span>
              <span>料金(税込)</span>
              <span>所要時間</span>
              <span />
            </div>

            {groups.map((group) => (
              <CategorySection
                key={group.id}
                group={group}
                orderedIds={order[group.id]}
                onReorder={(ids) =>
                  setOrder((current) => ({ ...current, [group.id]: ids }))
                }
                onRevert={() =>
                  setOrder((current) => {
                    const next = { ...current };
                    delete next[group.id];
                    return next;
                  })
                }
                onMessage={setMessage}
                onEdit={(menu) => {
                  setMessage(null);
                  setEditing({ menu });
                }}
              />
            ))}
          </>
        )}
      </div>

      {editing !== null && (
        <MenuEditDialog
          menu={editing.menu}
          categories={categories}
          onClose={() => setEditing(null)}
        />
      )}

      {isCategoryOpen && (
        <CategoryEditDialog
          categories={categories}
          menuCounts={menuCounts}
          onClose={() => setIsCategoryOpen(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// カテゴリ1つぶんの区切り行 + その下のメニュー(並べ替えの単位)
// ---------------------------------------------------------------------------

function CategorySection({
  group,
  orderedIds,
  onReorder,
  onRevert,
  onMessage,
  onEdit,
}: {
  group: MenuAdminGroup;
  /** ドラッグ直後の並び(未操作なら undefined = サーバーの並びのまま) */
  orderedIds: string[] | undefined;
  onReorder: (ids: string[]) => void;
  onRevert: () => void;
  onMessage: (message: string | null) => void;
  onEdit: (menu: MenuRecord) => void;
}) {
  const router = useRouter();
  const sensors = useSortableSensors();
  const [isPending, startTransition] = useTransition();

  // 上書きの並びがあればそれに従う(サーバーの行に無いIDは捨てる)
  const menus =
    orderedIds === undefined
      ? group.menus
      : orderedIds
          .map((id) => group.menus.find((menu) => menu.id === id))
          .filter((menu): menu is MenuRecord => menu !== undefined);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over === null || active.id === over.id) return;

    const ids = menus.map((menu) => menu.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;

    const next = arrayMove(ids, from, to);
    onMessage(null);
    onReorder(next);

    startTransition(async () => {
      const result = await saveMenuOrder({
        categoryId: group.id,
        orderedIds: next,
      });
      if (result.ok) {
        router.refresh();
        return;
      }
      // 保存できなかったら見た目も元に戻す(画面とDBを食い違わせない)
      onRevert();
      onMessage(result.message);
    });
  };

  return (
    <section aria-labelledby={`category-${group.id}`}>
      {/* カテゴリ名の区切り行(モックFの淡色の行) */}
      <h2
        id={`category-${group.id}`}
        className="bg-muted px-6 py-2 text-sm font-bold text-muted-foreground md:px-8"
      >
        {group.name}
      </h2>

      {menus.length === 0 ? (
        <p className="px-6 py-3 text-sm text-muted-foreground md:px-8">
          このカテゴリにはメニューがありません。
        </p>
      ) : (
        <DndContext
          // IDを明示する。省略すると @dnd-kit が描画のたびに採番する連番で
          // aria-describedby を作るため、サーバーとクライアントで値がずれて
          // ハイドレーションの警告が出る(実物のソースで確認)
          id={`menu-sort-${group.id}`}
          sensors={sensors}
          collisionDetection={closestCenter}
          accessibility={{
            screenReaderInstructions: sortableScreenReaderInstructions,
            announcements: sortableAnnouncements(
              (id) => menus.find((menu) => menu.id === id)?.name ?? "",
            ),
          }}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={menus.map((menu) => menu.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className={cn(isPending && "opacity-70")}>
              {menus.map((menu) => (
                <MenuRow key={menu.id} menu={menu} onEdit={onEdit} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// メニュー1行(モックFの「⣿ 名前 / 料金 / 所要時間 / 編集」)
// ---------------------------------------------------------------------------

function MenuRow({
  menu,
  onEdit,
}: {
  menu: MenuRecord;
  onEdit: (menu: MenuRecord) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: menu.id });

  return (
    <li
      ref={setNodeRef}
      style={{
        // 縦一列の並べ替えなので、拡大縮小のない Translate を使い、
        // 横方向のずれ(x)は捨てて上下の移動だけを見せる
        transform: CSS.Translate.toString(
          transform === null ? null : { ...transform, x: 0 },
        ),
        transition,
      }}
      className={cn(
        "border-t border-border bg-card first:border-t-0",
        isDragging && "relative z-10 shadow-lg",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-3 px-6 py-3 md:px-8",
          rowGridClass,
        )}
      >
        {/* 掴む場所。タッチでのスクロールと取り合わないよう touch-none にする */}
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none active:cursor-grabbing"
        >
          <GripVertical aria-hidden="true" className="size-4" />
          <span className="sr-only">{menu.name}の表示順を変更</span>
        </button>

        {/* スマホ幅は「名前」の下に料金・所要時間を畳み、PC幅では列にする */}
        <div className="min-w-0 flex-1 md:contents">
          <p className="flex min-w-0 items-center gap-2 text-base font-bold text-foreground md:font-medium">
            <span className="truncate">{menu.name}</span>
            {!menu.isActive && (
              <span className="shrink-0 rounded-md bg-secondary px-2 py-0.5 text-xs font-normal text-secondary-foreground">
                非表示
              </span>
            )}
          </p>
          <div className="flex gap-3 text-sm text-muted-foreground md:contents">
            <span className="md:text-base md:text-foreground">
              {formatMenuPrice(menu.price)}
            </span>
            <span className="md:text-base md:text-foreground">
              {formatMenuDuration(menu.durationMinutes)}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onEdit(menu)}
          className="shrink-0 rounded-md text-base text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none md:justify-self-end"
        >
          編集
          <span className="sr-only">({menu.name})</span>
        </button>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// メニューの新規作成・編集(ダイアログ)
// ---------------------------------------------------------------------------

function MenuEditDialog({
  menu,
  categories,
  onClose,
}: {
  /** 編集対象。null なら新規作成 */
  menu: MenuRecord | null;
  categories: MenuCategoryRecord[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [input, setInput] = useState<MenuInput>(() => ({
    name: menu?.name ?? "",
    categoryId: menu?.categoryId ?? categories[0]?.id ?? "",
    price: menu === null ? "" : String(menu.price),
    durationMinutes: menu === null ? "" : String(menu.durationMinutes),
    isActive: menu?.isActive ?? true,
  }));
  const [errors, setErrors] = useState<MenuErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const update = (patch: Partial<MenuInput>) => {
    setMessage(null);
    setInput((current) => ({ ...current, ...patch }));
  };

  const handleSave = () => {
    setMessage(null);
    const validated = validateMenuInput(input);
    if (!validated.ok) {
      setErrors(validated.errors);
      setMessage(validated.message);
      return;
    }
    setErrors({});
    startTransition(async () => {
      const result = await saveMenu({ id: menu?.id ?? null, input });
      if (result.ok) {
        onClose();
        router.refresh();
        return;
      }
      setMessage(result.message);
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="menu-edit-title"
    >
      {/* 背景(クリックで閉じる) */}
      <button
        type="button"
        aria-label="閉じる"
        className="absolute inset-0 bg-black/40 animate-in fade-in"
        onClick={onClose}
      />

      <div className="relative z-10 flex max-h-[90dvh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-2xl bg-card p-6 shadow-lg animate-in fade-in zoom-in-95 duration-200">
        <h2 id="menu-edit-title" className="text-xl font-bold text-foreground">
          {menu === null ? "新規メニュー" : "メニューの編集"}
        </h2>

        <div>
          <label htmlFor="menu-name" className={fieldLabelClass}>
            メニュー名
          </label>
          <input
            id="menu-name"
            type="text"
            value={input.name}
            onChange={(event) => update({ name: event.target.value })}
            className={cn(inputClass, "mt-1 w-full")}
          />
          {errors.name !== undefined && (
            <p role="alert" className="mt-1 text-sm text-destructive">
              {errors.name}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="menu-category" className={fieldLabelClass}>
            カテゴリ
          </label>
          <select
            id="menu-category"
            value={input.categoryId}
            onChange={(event) => update({ categoryId: event.target.value })}
            className={cn(inputClass, "mt-1 w-full")}
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          {errors.categoryId !== undefined && (
            <p role="alert" className="mt-1 text-sm text-destructive">
              {errors.categoryId}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="menu-price" className={fieldLabelClass}>
              料金(税込)
            </label>
            <input
              id="menu-price"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={input.price}
              onChange={(event) => update({ price: event.target.value })}
              className={cn(inputClass, "mt-1 w-full")}
            />
            {errors.price !== undefined && (
              <p role="alert" className="mt-1 text-sm text-destructive">
                {errors.price}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="menu-duration" className={fieldLabelClass}>
              所要時間(分)
            </label>
            <input
              id="menu-duration"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={input.durationMinutes}
              onChange={(event) =>
                update({ durationMinutes: event.target.value })
              }
              className={cn(inputClass, "mt-1 w-full")}
            />
            {errors.durationMinutes !== undefined && (
              <p role="alert" className="mt-1 text-sm text-destructive">
                {errors.durationMinutes}
              </p>
            )}
          </div>
        </div>

        <div>
          <p className={fieldLabelClass}>表示する</p>
          <div className="mt-1 flex items-center justify-between gap-3 rounded-xl bg-muted px-4 py-2">
            <span className="text-base text-foreground">
              {input.isActive
                ? "お客様の予約画面に表示する"
                : "お客様の予約画面に表示しない"}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={input.isActive}
              aria-label="このメニューをお客様の予約画面に表示する"
              onClick={() => update({ isActive: !input.isActive })}
              className={cn(
                "relative h-8 w-14 shrink-0 rounded-full transition-colors",
                input.isActive ? "bg-primary" : "bg-input",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "absolute top-1 size-6 rounded-full bg-card transition-all",
                  input.isActive ? "left-7" : "left-1",
                )}
              />
            </button>
          </div>
        </div>

        {/* 物理削除は提供しない。文言も純粋関数側(lib)に置いて画面と揃える */}
        <p className="rounded-lg bg-accent px-4 py-3 text-sm text-accent-foreground">
          {MENU_HIDE_INSTEAD_OF_DELETE_LINES.map((line, index) => (
            <Fragment key={line}>
              {index > 0 && <br />}
              {line}
            </Fragment>
          ))}
        </p>

        <div className="flex flex-wrap items-center gap-3">
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
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            className="h-11 rounded-xl px-4 text-base"
          >
            キャンセル
          </Button>
        </div>

        {message !== null && (
          <p role="alert" className="text-sm text-destructive">
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
