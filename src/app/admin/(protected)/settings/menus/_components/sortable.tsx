"use client";

// メニュー管理のドラッグ&ドロップ(@dnd-kit)の共通部品。
// メニュー一覧(モックF)とカテゴリ編集ダイアログ(モックF詳細)の両方で使う。
//
// ここに置いているのは「操作の仕掛け」だけで、並べ替えの結果をどう保存するか
// (display_order の再採番)は純粋関数 src/lib/menu-settings.ts が持つ。
// src/lib/ に @dnd-kit を import しないための境界。

import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type ScreenReaderInstructions,
  type SensorDescriptor,
  type SensorOptions,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";

/**
 * 並べ替えのセンサー。
 *
 * - PointerSensor … マウス・タッチ・ペンをまとめて扱う(onPointerDown を
 *   起点にする実装であることをインストール済みのソースで確認した)。
 *   8px 動かすまで開始しないので、行の「編集」などのクリックを邪魔しない。
 *   タッチでのスクロールと取り合いにならないよう、掴む場所(ハンドル)には
 *   touch-none(touch-action: none)を当てること
 * - KeyboardSensor … ハンドルにフォーカスしてスペース/Enterで掴み、
 *   矢印キーで移動、もう一度スペース/Enterで確定する。座標の求め方は
 *   sortable が用意する sortableKeyboardCoordinates を使う
 */
export function useSortableSensors(): SensorDescriptor<SensorOptions>[] {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
}

/** スクリーンリーダー向けの操作説明(既定の英語文言を日本語に差し替える) */
export const sortableScreenReaderInstructions: ScreenReaderInstructions = {
  draggable:
    "スペースキーまたはEnterキーで並べ替えを開始します。矢印キーで移動し、もう一度スペースキーまたはEnterキーで確定、Escapeキーで取り消します。",
};

/**
 * 並べ替え中の読み上げ文言(既定はIDをそのまま読むため日本語の名前に差し替える)。
 * @param labelOf ドラッグ中の要素のIDから表示名を引く
 */
export function sortableAnnouncements(
  labelOf: (id: string) => string,
): Announcements {
  return {
    onDragStart: ({ active }) => `${labelOf(String(active.id))} を掴みました。`,
    onDragOver: ({ active, over }) =>
      over === null
        ? `${labelOf(String(active.id))} は並べ替えの範囲から外れています。`
        : `${labelOf(String(active.id))} を ${labelOf(String(over.id))} の位置へ移動しています。`,
    onDragEnd: ({ active, over }) =>
      over === null
        ? `${labelOf(String(active.id))} の並べ替えを取り消しました。`
        : `${labelOf(String(active.id))} を ${labelOf(String(over.id))} の位置に移動しました。`,
    onDragCancel: ({ active }) =>
      `${labelOf(String(active.id))} の並べ替えを取り消しました。`,
  };
}
