// スタッフの色分け(日表示の予約カード・週表示の凡例: モックB/B-2)。
// 色はデザイントークン(globals.css)のみを使い、スタッフの並び順
// (display_order)で決める。店舗固有値は持たない(ADR-007)。
// 方針は docs/milestone-4c-plan.md「スタッフ色と休憩」(モックの README 準拠):
// 1人目 = テーマ色(--primary / --accent に追従)、2人目 = ニュートラル、
// 3人目以降 = ダスティブルー(モックに指定が無いので循環させず全員同じ色)。

export type StaffColor = {
  /** 凡例の色見本(■) */
  legend: string;
  /** 予約カード(左ボーダー+淡色背景) */
  card: string;
};

// 左ボーダーと凡例は同じ staff-N を使い、対応が取れるようにする。
// 休憩(bg-break-surface)・予約不可/定休日(bg-calendar-closed)とは下地の色が近い
// 組み合わせもあるため、色だけに頼らず帯の色・ラベル・斜線で区別する
// (timeline-column.tsx の TimelineBlocks)
const STAFF_COLORS: StaffColor[] = [
  {
    legend: "bg-staff-1",
    card: "border-l-staff-1 bg-staff-1-surface text-foreground",
  },
  {
    legend: "bg-staff-2",
    card: "border-l-staff-2 bg-staff-2-surface text-foreground",
  },
  {
    legend: "bg-staff-3",
    card: "border-l-staff-3 bg-staff-3-surface text-foreground",
  },
];

/** スタッフの表示順(index)から色分けを決める(3人目以降はすべて3人目の色) */
export function staffColor(index: number): StaffColor {
  return STAFF_COLORS[Math.min(index, STAFF_COLORS.length - 1)];
}
