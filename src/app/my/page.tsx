import { MyReservations } from "./_components/my-reservations";

// マイ予約(M3)。一覧の取得にはLIFFのIDトークンが必要なため、
// データ取得はクライアント側からServer Action経由で行う(ページは配線のみ)
export default function MyPage() {
  return <MyReservations />;
}
