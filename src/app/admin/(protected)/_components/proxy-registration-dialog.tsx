"use client";

// カレンダーの空き枠クリックから開く代行登録ダイアログ(非モーダル・ドラッグ可)。
// 電話を受けながらカレンダーの空きを見て登録する運用のため、
// - 画面を暗くするオーバーレイを敷かない(背後のカレンダーが見えて操作もできる)
// - ヘッダーをつかんで移動できる(位置のクランプは admin-calendar.ts の純粋関数)
// 中身は /admin/reservations/new と同じ ProxyRegistrationForm を再利用する。
// 非モーダルなので aria-modal は付けない(付けると背後が読み上げ対象外になる)。

import { GripHorizontal, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { ProxyRegistrationForm } from "@/app/admin/(protected)/reservations/new/_components/proxy-registration-form";
import {
  clampDialogPosition,
  dialogInitialX,
  type AdminStaff,
} from "@/lib/admin-calendar";
import type { ActiveMenu } from "@/server/admin-data";

/**
 * フローティングパネルの寸法(px)。Tailwind のクラス(w-[26rem])と対応させる。
 * - 26rem = 416px: 代行登録フォームの入力欄・空き時間の5列グリッドが
 *   窮屈にならない最小幅(モックDのフォーム幅 max-w-2xl の約半分)
 * - 余白 16px: 画面端に貼り付かず、つかみ直せる程度に残す
 */
const PANEL_WIDTH = 416;
const VIEWPORT_MARGIN = 16;
/**
 * 初期表示のY座標(px)。カレンダーのヘッダー(高さ約57px)より下に置き、
 * 日付ナビ・日/週トグルを隠さない位置から始める。
 */
const INITIAL_TOP = 72;

/** md ブレークポイント(Tailwind と揃える)。未満はドラッグせずシート表示 */
const DESKTOP_QUERY = "(min-width: 768px)";

export type ProxyRegistrationTarget = {
  staffId: string;
  /** JSTの暦日 "YYYY-MM-DD" */
  date: string;
  /** 壁時計時刻 "HH:MM" */
  time: string;
  /**
   * クリックしたスタッフ列と、スタッフ列グリッド全体の左右X
   * (ビューポート座標のpx)。押した列以外の領域の中央にダイアログを
   * 重ねるために使う(dialogInitialX)
   */
  columnLeft: number;
  columnRight: number;
  gridLeft: number;
  gridRight: number;
};

type Props = {
  staff: AdminStaff[];
  menus: ActiveMenu[];
  target: ProxyRegistrationTarget;
  onClose: () => void;
  /** 登録成功(画面遷移はしない。呼び出し側が閉じて router.refresh() する) */
  onSuccess: () => void;
};

export function ProxyRegistrationDialog({
  staff,
  menus,
  target,
  onClose,
  onSuccess,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  // md 未満はフローティングをやめ、画面下からのシートにフォールバックする
  // (狭い画面ではドラッグ移動より全幅で入力できることを優先する)。
  // このダイアログは空き枠クリック後にだけマウントされる = 必ずクライアント側の
  // 描画なので、初期値を window から読んでもハイドレーション不一致は起きない
  const [isDesktop, setIsDesktop] = useState(
    () => window.matchMedia(DESKTOP_QUERY).matches,
  );

  // パネルの位置(fixed の left/top)。初期の左右はクリックしたスタッフ列
  // 以外の領域の中央(dialogInitialX)= いま見たい列の空き状況を隠さない位置
  const [position, setPosition] = useState<{ x: number; y: number }>(() =>
    clampDialogPosition({
      x: dialogInitialX({
        clickedColumnLeft: target.columnLeft,
        clickedColumnRight: target.columnRight,
        gridLeft: target.gridLeft,
        gridRight: target.gridRight,
        viewportWidth: window.innerWidth,
        dialogWidth: PANEL_WIDTH,
        margin: VIEWPORT_MARGIN,
      }),
      y: INITIAL_TOP,
      width: PANEL_WIDTH,
      // 初回は未描画で実寸が測れない。高さ0で扱うと上端(margin〜)には
      // 必ず収まる。実寸でのクランプはドラッグ・リサイズ時に行う
      height: 0,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      margin: VIEWPORT_MARGIN,
    }),
  );
  const [dragging, setDragging] = useState(false);
  // ドラッグ開始時の「つかんだ点」とパネル左上のずれ(px)
  const grabOffset = useRef({ x: 0, y: 0 });

  /** 現在のパネル実寸でビューポート内に収める */
  const clampToViewport = useCallback((x: number, y: number) => {
    const rect = panelRef.current?.getBoundingClientRect();
    return clampDialogPosition({
      x,
      y,
      width: rect?.width ?? PANEL_WIDTH,
      height: rect?.height ?? 0,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      margin: VIEWPORT_MARGIN,
    });
  }, []);

  // ウィンドウのリサイズ・幅ブレークポイントの変化を外部システムとして購読する。
  // リサイズでパネルが画面外に取り残されないよう、実寸で再クランプする
  useEffect(() => {
    const media = window.matchMedia(DESKTOP_QUERY);
    const onResize = () => {
      setIsDesktop(media.matches);
      setPosition((prev) => clampToViewport(prev.x, prev.y));
    };
    window.addEventListener("resize", onResize);
    media.addEventListener("change", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      media.removeEventListener("change", onResize);
    };
  }, [clampToViewport]);

  // Escape で閉じる(非モーダルでもキーボードから抜けられるように)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // --- ドラッグ(pointer events + setPointerCapture) -------------------------
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDesktop) return;
    // 閉じるボタンなどヘッダー内のボタン操作はドラッグにしない
    if ((event.target as HTMLElement).closest("button") !== null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    grabOffset.current = {
      x: event.clientX - position.x,
      y: event.clientY - position.y,
    };
    setDragging(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setPosition(
      clampToViewport(
        event.clientX - grabOffset.current.x,
        event.clientY - grabOffset.current.y,
      ),
    );
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
  };

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="電話予約の代行登録"
      // オーバーレイは敷かない(背後のカレンダーを見ながら操作できることが要件)。
      // md未満: 画面下からのシート / md以上: ドラッグできるフローティングパネル
      className={
        isDesktop
          ? // 高さは初期位置(上から72px)+ 下余白ぶんを引いて、開いた直後から
            // 画面内に収まるようにする(ドラッグ後の再クランプは実寸で行う)
            "fixed z-50 flex max-h-[calc(100dvh-6rem)] w-[26rem] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-lg"
          : "fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col overflow-hidden rounded-t-3xl border-t border-border bg-card shadow-lg animate-in slide-in-from-bottom duration-200"
      }
      style={isDesktop ? { left: position.x, top: position.y } : undefined}
    >
      {/* ヘッダー = ドラッグハンドル(md未満はつかめないので通常のヘッダー) */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={
          isDesktop
            ? `flex shrink-0 touch-none items-center gap-2 border-b border-border bg-muted px-4 py-3 ${
                dragging ? "cursor-grabbing" : "cursor-grab"
              }`
            : "flex shrink-0 items-center gap-2 border-b border-border bg-muted px-4 py-3"
        }
      >
        {isDesktop && (
          <GripHorizontal
            aria-hidden="true"
            className="size-5 text-muted-foreground"
          />
        )}
        <h2 className="text-base font-bold">電話予約の代行登録</h2>
        <button
          type="button"
          aria-label="閉じる"
          onClick={onClose}
          className="ml-auto flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
        >
          <X aria-hidden="true" className="size-5" />
        </button>
      </div>

      {/* 本体(フォームが縦に長いのでパネル内でスクロールする) */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <ProxyRegistrationForm
          variant="dialog"
          staff={staff}
          menus={menus}
          defaultDate={target.date}
          initial={{
            menuIds: [],
            staffId: target.staffId,
            date: target.date,
            time: target.time,
            note: "",
          }}
          onSuccess={onSuccess}
        />
      </div>
    </div>
  );
}
