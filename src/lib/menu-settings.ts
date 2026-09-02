// メニュー管理画面(モックF・F詳細)の判断ロジック(純粋関数)。
// UI・Server Action は配線に徹し、判断はここへ押し戻す(CLAUDE.md)。
// DOM・Supabaseクライアント・@dnd-kit の import はしない。
// ドラッグ&ドロップそのものはUIの仕事で、ここが受け取るのは
// 「並べ替え後のIDの並び」という値だけにする。
//
// 扱うのは2つ:
//   1. menus           … メニュー(名前・カテゴリ・料金・所要時間・表示順・表示可否)
//   2. menu_categories … カテゴリ(名前・説明・表示順)
//
// DB制約と同じルールをUIでも先出しするのがこのファイルの役割で、
// 最後の砦はあくまでDB制約(ADR-004と同じ考え方)。
// メニュー名・料金・カテゴリ名といった店舗固有の値はここには書かない(ADR-007)。

// ---------------------------------------------------------------------------
// 画面が扱うレコード
// ---------------------------------------------------------------------------

/** menu_categories の1行(画面が扱う形) */
export type MenuCategoryRecord = {
  id: string;
  name: string;
  /**
   * 客側のカテゴリ見出しの下に出る説明文。
   * M4bのカテゴリ編集ダイアログ(モックF詳細)は名前だけを編集するため
   * この画面では変更しない。保存時も触らないので既存の値は保たれる。
   */
  description: string | null;
  displayOrder: number;
};

/** menus の1行(画面が扱う形) */
export type MenuRecord = {
  id: string;
  name: string;
  categoryId: string;
  price: number;
  durationMinutes: number;
  displayOrder: number;
  isActive: boolean;
};

// ---------------------------------------------------------------------------
// 1. 表示の整形(モックFの「料金(税込)」「所要時間」列)
// ---------------------------------------------------------------------------

/**
 * 料金を「¥4,620」形式にする。
 * 可変価格(「¥11,000〜」)はM4bの対象外なので固定価格だけを扱う。
 */
export function formatMenuPrice(price: number): string {
  return `¥${price.toLocaleString("ja-JP")}`;
}

/** 所要時間を「60分」形式にする(可変時間「180分〜」はM4bの対象外) */
export function formatMenuDuration(minutes: number): string {
  return `${minutes}分`;
}

// ---------------------------------------------------------------------------
// 2. カテゴリごとのグルーピング(モックFの淡色の区切り行 + その下のメニュー)
// ---------------------------------------------------------------------------

/** カテゴリ1つと、その下に並ぶメニュー(表示順) */
export type MenuAdminGroup = MenuCategoryRecord & { menus: MenuRecord[] };

/**
 * メニューをカテゴリごとにまとめ、カテゴリ・メニューとも表示順に並べる。
 *
 * 客側の booking.ts に同種の groupMenusByCategory があるが再利用しない。
 * あちらは「表示できるメニューが1件も無いカテゴリは見出しごと出さない」
 * ため、カテゴリを作った直後(まだメニューが無い)にその行が管理画面から
 * 消えてしまい、メニューを足す先が見えなくなる。管理画面は空のカテゴリも
 * 非表示メニューも出す必要があり、並べ替えのために display_order も要る、
 * という別の要件なのでこちらに置く。
 *
 * 表示順が同じメニューは名前順にして、保存のたびに並びが揺れないようにする
 * (display_order に一意制約は無く、同値になりうるため)。
 */
export function buildMenuAdminGroups(
  categories: readonly MenuCategoryRecord[],
  menus: readonly MenuRecord[],
): MenuAdminGroup[] {
  return [...categories]
    .sort(compareByDisplayOrderThenName)
    .map((category) => ({
      ...category,
      menus: menus
        .filter((menu) => menu.categoryId === category.id)
        .sort(compareByDisplayOrderThenName),
    }));
}

function compareByDisplayOrderThenName(
  a: { displayOrder: number; name: string },
  b: { displayOrder: number; name: string },
): number {
  if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder;
  return a.name.localeCompare(b.name, "ja");
}

// ---------------------------------------------------------------------------
// 3. 並べ替え結果の再採番(display_order)
// ---------------------------------------------------------------------------

/** 表示順を変える必要のある行(そのまま1行ぶんの更新になる) */
export type DisplayOrderChange = { id: string; displayOrder: number };

/**
 * 並べ替え後のIDの並びを display_order の連番(0起点)に直す。
 * **変更が必要な行だけ**返すので、動かさなかった行はUPDATEしない。
 *
 * メニューの並べ替えはカテゴリ内に限定する(カテゴリの変更はメニュー編集
 * ダイアログで行う)という決定に合わせ、`current` に無いIDは黙って無視する。
 * 呼び出し側が「そのカテゴリのメニュー」だけを `current` に渡せば、
 * 画面から別カテゴリのIDが混ざってきても他のカテゴリを壊さない。
 *
 * 逆に `current` にあって並びに現れなかった行は末尾へ回す。
 * 取りこぼしがあっても行が消えたり同じ表示順で衝突したりしないようにする。
 */
export function renumberDisplayOrder(
  orderedIds: readonly string[],
  current: ReadonlyArray<{ id: string; displayOrder: number }>,
): DisplayOrderChange[] {
  const known = new Map(current.map((row) => [row.id, row.displayOrder]));

  const ordered = orderedIds.filter((id) => known.has(id));
  const missing = current
    .filter((row) => !ordered.includes(row.id))
    .map((row) => row.id);

  return [...ordered, ...missing]
    .map((id, index) => ({ id, displayOrder: index }))
    .filter((row) => known.get(row.id) !== row.displayOrder);
}

// ---------------------------------------------------------------------------
// 4. メニューのバリデーション(menus のDB制約と同じルール)
// ---------------------------------------------------------------------------

/** メニュー編集ダイアログの入力値(input の生の文字列) */
export type MenuInput = {
  name: string;
  /** select の生値。空文字は未選択 */
  categoryId: string;
  /** input[type=number] の生値 */
  price: string;
  /** input[type=number] の生値 */
  durationMinutes: string;
  isActive: boolean;
};

/** 各項目のエラーメッセージ(存在する項目だけ入る) */
export type MenuErrors = {
  name?: string;
  categoryId?: string;
  price?: string;
  durationMinutes?: string;
};

/** 検証済みの値(そのまま menus へ insert/update できる形) */
export type MenuValue = {
  name: string;
  categoryId: string;
  price: number;
  durationMinutes: number;
  isActive: boolean;
};

export type MenuValidationResult =
  | { ok: true; value: MenuValue }
  | { ok: false; errors: MenuErrors; message: string };

/** メニューの入力全体のエラーメッセージ(フォームの先頭に出す) */
export const MENU_INVALID_MESSAGE = "メニューの入力が正しくありません";

/**
 * メニューを物理削除しない理由の説明(編集ダイアログに出す)。
 *
 * reservation_menus.menu_id が menus を参照している(on delete set null)。
 * 消しても過去の予約の表示は壊れない(名前・料金・所要時間はスナップショット)が、
 * 元メニューへの対応が切れて「どのメニューだったか」を後からたどれなくなる。
 * 運用上は非表示(is_active = false)で足りるので、そちらを使う。
 */
export const MENU_HIDE_INSTEAD_OF_DELETE_MESSAGE =
  "メニューの削除はできません。過去の予約が参照しているため、使わなくなったメニューは「表示する」をオフにしてください。オフにするとお客様の予約画面に出なくなり、過去の予約はそのまま残ります。";

/**
 * メニューの入力を検証する。DB制約と同じルールを先出しする:
 * - name は NOT NULL(前後の空白は落とす)
 * - category_id は NOT NULL(カテゴリ必須。存在するIDかどうかは外部キーが見る)
 * - price は integer かつ price >= 0
 * - duration_minutes は integer かつ duration_minutes > 0
 *
 * 可変価格・可変時間(「¥11,000〜」「180分〜」)はM4bの対象外なので、
 * ここでは固定の1値だけを受け付ける。
 */
export function validateMenuInput(input: MenuInput): MenuValidationResult {
  const errors: MenuErrors = {};

  const name = input.name.trim();
  if (name === "") {
    errors.name = "メニュー名を入力してください";
  }

  const categoryId = input.categoryId.trim();
  if (categoryId === "") {
    errors.categoryId = "カテゴリを選択してください";
  }

  const price = Number(input.price);
  if (input.price.trim() === "" || !Number.isInteger(price) || price < 0) {
    errors.price = "料金は0以上の整数で入力してください";
  }

  const durationMinutes = Number(input.durationMinutes);
  if (
    input.durationMinutes.trim() === "" ||
    !Number.isInteger(durationMinutes) ||
    durationMinutes <= 0
  ) {
    errors.durationMinutes = "所要時間は1分以上の整数で入力してください";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors, message: MENU_INVALID_MESSAGE };
  }

  return {
    ok: true,
    value: {
      name,
      categoryId,
      price,
      durationMinutes,
      isActive: input.isActive,
    },
  };
}

// ---------------------------------------------------------------------------
// 5. カテゴリ編集ダイアログ(モックF詳細)
// ---------------------------------------------------------------------------
//
// ダイアログは「追加・名称変更・削除・並べ替え」をまとめて「保存する」で
// 確定する。画面の行(ドラフト)と現在のDBの行を突き合わせて、
// insert / update / delete に振り分けるのがここの仕事。

/**
 * ダイアログの1行。
 * - id が null … まだDBに無い行(新規追加)
 * - key       … Reactのkey兼ドラッグ&ドロップの識別子。既存行はIDと同じで、
 *   新規行は呼び出し側が採番する。IDだけだと新規行を識別できないため分ける
 */
export type CategoryDraft = { key: string; id: string | null; name: string };

/** 現在のカテゴリをダイアログの行(表示順)に変換する */
export function toCategoryDrafts(
  categories: readonly MenuCategoryRecord[],
): CategoryDraft[] {
  return [...categories]
    .sort(compareByDisplayOrderThenName)
    .map((category) => ({
      key: category.id,
      id: category.id,
      name: category.name,
    }));
}

export type CategoryDraftsResult =
  | { ok: true; value: CategoryDraft[] }
  | {
      ok: false;
      /** 行のキー → その行のエラーメッセージ(入力欄の下に出す) */
      errors: Record<string, string>;
      message: string;
    };

/** カテゴリの入力全体のエラーメッセージ(ダイアログの先頭に出す) */
export const CATEGORY_INVALID_MESSAGE = "カテゴリの入力が正しくありません";

/**
 * カテゴリ名を検証する(menu_categories.name は NOT NULL)。
 * 同名のカテゴリはDBに制約が無いので、ここでも禁止しない
 * (「カット(メンズ)」「カット(レディース)」のような使い分けを妨げない)。
 */
export function validateCategoryDrafts(
  drafts: readonly CategoryDraft[],
): CategoryDraftsResult {
  const errors: Record<string, string> = {};
  const value: CategoryDraft[] = [];

  for (const draft of drafts) {
    const name = draft.name.trim();
    if (name === "") {
      errors[draft.key] = "カテゴリ名を入力してください";
      continue;
    }
    value.push({ key: draft.key, id: draft.id, name });
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors, message: CATEGORY_INVALID_MESSAGE };
  }
  return { ok: true, value };
}

/** まとめ保存でDBに投げる操作(空の配列は「その操作は不要」) */
export type MenuCategoryDiff = {
  inserts: Array<{ name: string; displayOrder: number }>;
  updates: Array<{ id: string; name: string; displayOrder: number }>;
  deleteIds: string[];
};

/**
 * ダイアログの行と現在のカテゴリを突き合わせ、insert / update / delete に振り分ける。
 *
 * - 行の位置がそのまま display_order(0起点)になる
 * - 名前も位置も変わらない行はUPDATEしない
 * - 現在に無いIDを持つ行は無視する(別の画面で消された後の保存。
 *   消えた行を作り直すと、ユーザーが意図していない復活になる)
 * - ドラフトに現れなかった現在の行は削除。削除して良いかの判定は
 *   findCategoryDeleteViolation が別に行う(所属メニューがあると消せない)
 *
 * description は触らない。M4bのダイアログは名前だけを編集するので、
 * UPDATEの対象から外して既存の説明文を保つ。
 */
export function diffMenuCategories(params: {
  current: readonly MenuCategoryRecord[];
  drafts: readonly CategoryDraft[];
}): MenuCategoryDiff {
  const { current, drafts } = params;
  const currentById = new Map(
    current.map((category) => [category.id, category]),
  );

  const inserts: MenuCategoryDiff["inserts"] = [];
  const updates: MenuCategoryDiff["updates"] = [];
  const keptIds = new Set<string>();

  drafts.forEach((draft, index) => {
    if (draft.id === null) {
      inserts.push({ name: draft.name, displayOrder: index });
      return;
    }
    const existing = currentById.get(draft.id);
    if (existing === undefined) return; // 既に消えている行は触らない

    keptIds.add(draft.id);
    if (existing.name !== draft.name || existing.displayOrder !== index) {
      updates.push({ id: draft.id, name: draft.name, displayOrder: index });
    }
  });

  return {
    inserts,
    updates,
    deleteIds: current
      .filter((category) => !keptIds.has(category.id))
      .map((category) => category.id),
  };
}

/** カテゴリごとの所属メニュー数(非表示のメニューも数える) */
export function countMenusByCategory(
  menus: ReadonlyArray<{ categoryId: string }>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const menu of menus) {
    counts[menu.categoryId] = (counts[menu.categoryId] ?? 0) + 1;
  }
  return counts;
}

/** 所属メニューが残っているカテゴリを削除しようとしたときの文言 */
export function categoryDeleteBlockedMessage(params: {
  name: string;
  menuCount: number;
}): string {
  return `「${params.name}」にはメニューが${params.menuCount}件あるため削除できません。先にそのメニューのカテゴリを変更してください(非表示にしただけでは削除できません)`;
}

/**
 * 削除しようとしているカテゴリに所属メニューが残っていないか調べる。
 * 残っていればその理由、問題なければ null を返す。
 *
 * menus.category_id は NOT NULL なので、カテゴリを消すとメニューの
 * 行き先が無くなる(外部キーが 23503 で拒否する)。非表示のメニューも
 * 参照は残っているので同じく消せない。
 */
export function findCategoryDeleteViolation(params: {
  deleteIds: readonly string[];
  categories: readonly MenuCategoryRecord[];
  menus: ReadonlyArray<{ categoryId: string }>;
}): string | null {
  const counts = countMenusByCategory(params.menus);

  for (const id of params.deleteIds) {
    const menuCount = counts[id] ?? 0;
    if (menuCount === 0) continue;
    const name =
      params.categories.find((category) => category.id === id)?.name ?? "";
    return categoryDeleteBlockedMessage({ name, menuCount });
  }
  return null;
}
