// スタッフの色分け(日表示の予約カード・週表示の凡例: モックB/B-2)。
// 色はデザイントークン(globals.css)のみを使い、スタッフの並び順
// (display_order)に応じて循環させる。店舗固有値は持たない(ADR-007)。

export type StaffColor = {
  /** 凡例の色見本(■) */
  legend: string;
  /** 予約カード(左ボーダー+淡色背景) */
  card: string;
};

// 下地(bg-staff-N-surface)は休憩(bg-muted)・予約不可/定休日(bg-secondary)の
// どれとも重ならない専用トークン。以前は accent / muted / secondary を流用して
// いたため、スタッフ列で「休憩と予約」「予約不可と予約」が同色になっていた。
// 左ボーダーと凡例は同じ staff-N を使い、対応が取れるようにする。
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

/** スタッフの表示順(index)から色分けを決める(スタッフ数分を循環) */
export function staffColor(index: number): StaffColor {
  return STAFF_COLORS[index % STAFF_COLORS.length];
}
