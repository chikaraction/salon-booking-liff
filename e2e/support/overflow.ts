// 画面幅のチェック(ADR-008 範囲1)の判定。ブラウザ内で実行し、はみ出しの一覧を返す。
// - 画面の横スクロール: ページ全体が画面幅より広い
// - 画面外へのはみ出し: 要素が画面の左右の端を越えている(横スクロールする箱の中は除く)
// - カードからのはみ出し: 枠線か影のある箱から、中の要素が左右に出ている
// - 欄に収まらない: 入力欄・ボタンの中身が欄の幅に収まっていない

import type { Page } from "@playwright/test";

export type OverflowIssue = {
  kind:
    | "横スクロール"
    | "画面外へのはみ出し"
    | "カードからのはみ出し"
    | "欄に収まらない";
  element: string;
  detail: string;
};

export async function findOverflowIssues(page: Page): Promise<OverflowIssue[]> {
  return page.evaluate(() => {
    const TOLERANCE = 1;
    const viewportWidth = document.documentElement.clientWidth;
    const issues: OverflowIssue[] = [];

    const describe = (el: Element): string => {
      const tag = el.tagName.toLowerCase();
      const id = el.id ? `#${el.id}` : "";
      const label =
        el.getAttribute("aria-label") ??
        (el as HTMLElement).innerText
          ?.replace(/\s+/g, " ")
          .trim()
          .slice(0, 30) ??
        "";
      const classes = (el.getAttribute("class") ?? "")
        .split(/\s+/)
        .slice(0, 4)
        .join(".");
      return `${tag}${id}${classes ? `.${classes}` : ""}${label ? ` 「${label}」` : ""}`;
    };

    const isRendered = (el: Element): boolean => {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden")
        return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    // 横方向を切り取る・スクロールさせる箱(この中のはみ出しは意図したもの)
    const clipsX = (el: Element): boolean =>
      getComputedStyle(el).overflowX !== "visible";

    const isOutOfFlow = (el: Element): boolean => {
      const position = getComputedStyle(el).position;
      return position === "absolute" || position === "fixed";
    };

    // el から祖先(stop の手前まで)に、切り取る箱か位置指定の要素があるか
    const hasClipOrOutOfFlowBetween = (
      el: Element,
      stop: Element | null,
    ): boolean => {
      for (
        let node: Element | null = el;
        node && node !== stop;
        node = node.parentElement
      ) {
        if (node !== el && clipsX(node)) return true;
        if (isOutOfFlow(node)) return true;
      }
      return false;
    };

    const isCard = (el: Element): boolean => {
      const style = getComputedStyle(el);
      const bordered =
        parseFloat(style.borderLeftWidth) > 0 &&
        parseFloat(style.borderRightWidth) > 0;
      return (
        (bordered || style.boxShadow !== "none") &&
        style.overflowX === "visible"
      );
    };

    const scrollWidth = document.documentElement.scrollWidth;
    if (scrollWidth > viewportWidth + TOLERANCE) {
      issues.push({
        kind: "横スクロール",
        element: "html",
        detail: `ページの幅 ${scrollWidth}px > 画面の幅 ${viewportWidth}px`,
      });
    }

    const all = Array.from(document.body.querySelectorAll("*")).filter(
      isRendered,
    );

    // 画面外へのはみ出し(親もはみ出しているときは親だけを報告する)
    const offscreen = new Set<Element>();
    for (const el of all) {
      if (hasClipOrOutOfFlowBetween(el, document.body)) continue;
      const rect = el.getBoundingClientRect();
      const left = rect.left + window.scrollX;
      const right = rect.right + window.scrollX;
      if (right > viewportWidth + TOLERANCE || left < -TOLERANCE) {
        offscreen.add(el);
        if (el.parentElement && offscreen.has(el.parentElement)) continue;
        issues.push({
          kind: "画面外へのはみ出し",
          element: describe(el),
          detail: `左 ${Math.round(left)}px / 右 ${Math.round(right)}px(画面の幅 ${viewportWidth}px)`,
        });
      }
    }

    // カードからのはみ出し(いちばん外側のはみ出しだけを報告する)
    for (const card of all.filter(isCard)) {
      const cardRect = card.getBoundingClientRect();
      const reported = new Set<Element>();
      for (const child of Array.from(card.querySelectorAll("*")).filter(
        isRendered,
      )) {
        if (hasClipOrOutOfFlowBetween(child, card)) continue;
        if (child.parentElement && reported.has(child.parentElement)) {
          reported.add(child);
          continue;
        }
        const rect = child.getBoundingClientRect();
        if (
          rect.right > cardRect.right + TOLERANCE ||
          rect.left < cardRect.left - TOLERANCE
        ) {
          reported.add(child);
          issues.push({
            kind: "カードからのはみ出し",
            element: describe(child),
            detail: `カード ${describe(card)} の幅 ${Math.round(cardRect.left)}〜${Math.round(cardRect.right)}px に対し ${Math.round(rect.left)}〜${Math.round(rect.right)}px`,
          });
        }
      }
    }

    // 入力欄・ボタンの中身が欄の幅に収まっていない
    for (const control of document.querySelectorAll(
      "input, select, textarea, button",
    )) {
      if (!isRendered(control)) continue;
      const el = control as HTMLElement;
      if (getComputedStyle(el).textOverflow === "ellipsis") continue;
      if (el.scrollWidth > el.clientWidth + TOLERANCE) {
        issues.push({
          kind: "欄に収まらない",
          element: describe(el),
          detail: `中身の幅 ${el.scrollWidth}px > 欄の幅 ${el.clientWidth}px`,
        });
        continue;
      }

      // 時刻の入力欄は、Chromium だと中身が欠けても scrollWidth に表れない。
      // 幅を自動にした複製(ブラウザが中身に合わせた幅になる)より狭ければ欠けているとみなす。
      // 日付欄は Chromium が自動幅に余白を多めに取り、欠けていなくても引っかかるので対象外。
      // テスト用の WebKit(Windows版)は時刻入力に対応せず type が text になるので、これも対象外
      if (el instanceof HTMLInputElement && el.type === "time") {
        const probe = el.cloneNode() as HTMLInputElement;
        probe.removeAttribute("id");
        probe.style.cssText =
          "width:auto;min-width:0;max-width:none;flex:none;position:absolute;visibility:hidden;";
        el.parentElement?.appendChild(probe);
        const naturalWidth = probe.getBoundingClientRect().width;
        probe.remove();
        const width = el.getBoundingClientRect().width;
        if (width + TOLERANCE < naturalWidth) {
          issues.push({
            kind: "欄に収まらない",
            element: describe(el),
            detail: `欄の幅 ${Math.round(width)}px < 中身に必要な幅 ${Math.round(naturalWidth)}px`,
          });
        }
      }
    }

    return issues;
  });
}
