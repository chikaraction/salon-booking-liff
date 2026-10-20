"use client";

// カレンダー上に出す予約フォームのダイアログ(非モーダル・ドラッグ可)。
// 2つの用途を同じ枠で受け持つ:
// - 代行登録: 空き枠クリック(電話を受けながら空きを見て登録する運用)
// - 予約の変更: 予約詳細ダイアログの「変更」(ページ遷移すると背後の
//   カレンダーが見えず、詳細にも引き返せないという実機フィードバックへの対応)
// どちらも背後のカレンダーを見ながら日時を決めたいので、
// - 画面を暗くするオーバーレイを敷かない(背後のカレンダーが見えて操作もできる)
// - ヘッダーをつかんで移動できる(位置のクランプは admin-calendar.ts の純粋関数)
// 中身は /admin/reservations/new と同じ ProxyRegistrationForm を再利用する
// (変更は mode="edit"。ページ版 /admin/reservations/[id]/edit と同じ構成)。
// 非モーダルなので aria-modal は付けない(付けると背後が読み上げ対象外になる)。

import { GripHorizontal, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { ProxyRegistrationForm } from "@/app/admin/(protected)/reservations/new/_components/proxy-registration-form";
import {
  clampDialogPosition,
  formDialogInitialX,
  type AdminStaff,
  type ColumnAnchor,
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

/** 代行登録(カレンダーの空き枠クリック) */
export type ProxyRegistrationTarget = {
  mode: "create";
  /**
   * 担当スタッフ。日表示は列=スタッフなのでクリックで決まるが、週表示は
   * 列=日付で全スタッフが同じ列に並ぶため決まらない。省略した場合は
   * スタッフ未選択でフォームを開き、ダイアログ内のスタッフ選択で確定させる
   * (未選択のままの登録は validateProxyRegistration がフィールドエラーで弾く)
   */
  staffId?: string;
  /** JSTの暦日 "YYYY-MM-DD" */
  date: string;
  /** 壁時計時刻 "HH:MM" */
  time: string;
  /** クリックした列(初期位置の決定に使う) */
  anchor: ColumnAnchor | null;
};

/**
 * 予約の変更(予約詳細ダイアログの「変更」)。詳細ダイアログが取得済みの
 * ReservationDetail から呼び出し側が組み立てる(ダイアログ内で再取得しない)。
 */
export type ReservationEditTarget = {
  mode: "edit";
  reservationId: string;
  /** 変更モードで固定表示する顧客名(顧客は変更できない) */
  customerName: string;
  staffId: string;
  /** JSTの暦日 "YYYY-MM-DD" */
  date: string;
  /** 壁時計時刻 "HH:MM" */
  time: string;
  /** 現在も有効なメニューだけに絞ったメニューID(restoreSelectableMenuIds) */
  menuIds: string[];
  note: string;
  /**
   * 詳細を開いたきっかけになった予約カードが載っていた列。代行登録と同じ
   * 位置ロジックでダイアログを出すために持ち回る。スマホのリスト表示など
   * 列が分からない経路では null(右寄せにフォールバックする)
   */
  anchor: ColumnAnchor | null;
};

export type ReservationDialogTarget =
  ProxyRegistrationTarget | ReservationEditTarget;

type Props = {
  staff: AdminStaff[];
  menus: ActiveMenu[];
  target: ReservationDialogTarget;
  onClose: () => void;
  /** 登録・変更の成功(画面遷移はしない。呼び出し側が閉じて router.refresh() する) */
  onSuccess: () => void;
  /**
   * 変更モードで詳細ダイアログへ引き返す導線(店側キャンセルの「戻る」と同じ体験)。
   * 省略すると戻るボタンを出さない(代行登録には戻り先が無い)。
   * ボタンはフォームの送信ボタンの下に出る(ProxyRegistrationForm 側)。
   */
  onBack?: () => void;
  /**
   * フォームの日付が有効な日付に変わったときの通知(中継するだけ)。
   * 背後のカレンダーをその日付へ動かすかどうかは CalendarView が決める
   * (非モーダルなので、変更したい日が背後に出ていないと見比べられない)
   */
  onDateChange?: (date: string) => void;
};

export function ReservationFormDialog({
  staff,
  menus,
  target,
  onClose,
  onSuccess,
  onBack,
  onDateChange,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const isEdit = target.mode === "edit";
  const title = isEdit ? "予約の変更" : "電話予約の代行登録";

  // md 未満はフローティングをやめ、画面下からのシートにフォールバックする
  // (狭い画面ではドラッグ移動より全幅で入力できることを優先する)。
  // このダイアログは空き枠クリック・詳細の「変更」の後にだけマウントされる =
  // 必ずクライアント側の描画なので、初期値を window から読んでも
  // ハイドレーション不一致は起きない
  const [isDesktop, setIsDesktop] = useState(
    () => window.matchMedia(DESKTOP_QUERY).matches,
  );

  // パネルの位置(fixed の left/top)。初期の左右は代行登録・変更とも同じ
  // 経路(formDialogInitialX)で決める = 押した列以外の領域の中央に出るので、
  // いま見たい列の空き状況が隠れない。変更は予約カードのクリック時に測った
  // 列の座標(anchor)を持ち回る。列が分からない経路(スマホのリスト表示など)は
  // anchor が null で右寄せにフォールバックする。
  // 狙った列が隠れる場合はヘッダーをつかんで動かせる
  const [position, setPosition] = useState<{ x: number; y: number }>(() =>
    clampDialogPosition({
      x: formDialogInitialX({
        anchor: target.anchor,
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
    // 閉じる・戻るなどヘッダー内のボタン操作はドラッグにしない
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
      aria-label={title}
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
        <h2 className="text-base font-bold">{title}</h2>
        {/* 「詳細に戻る」はタイトルバーだと気づかれないという実機フィードバックを
            受けて、フォームの送信ボタンの下へ移した(キャンセル確認の
            「キャンセルする / 戻る」と同じ並び)。ここには置かない */}
        <button
          type="button"
          aria-label="閉じる"
          onClick={onClose}
          // ヘッダーの地(--muted)はページ背景と同じ値なので、hover は --secondary で
          // 少し濃くする(bg-background だと変化が見えない)
          className="ml-auto flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <X aria-hidden="true" className="size-5" />
        </button>
      </div>

      {/* 本体(フォームが縦に長いのでパネル内でスクロールする) */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <ProxyRegistrationForm
          variant="dialog"
          mode={target.mode}
          staff={staff}
          menus={menus}
          defaultDate={target.date}
          reservationId={
            target.mode === "edit" ? target.reservationId : undefined
          }
          fixedCustomerName={
            target.mode === "edit" ? target.customerName : undefined
          }
          initial={
            target.mode === "edit"
              ? {
                  menuIds: target.menuIds,
                  staffId: target.staffId,
                  date: target.date,
                  time: target.time,
                  note: target.note,
                }
              : {
                  menuIds: [],
                  // 週表示など担当が決まらないクリックでは空文字 = 未選択で開く
                  // (フォームの select は value="" が「選択してください」)
                  staffId: target.staffId ?? "",
                  date: target.date,
                  time: target.time,
                  note: "",
                }
          }
          onSuccess={onSuccess}
          onBack={onBack}
          onDateChange={onDateChange}
        />
      </div>
    </div>
  );
}
