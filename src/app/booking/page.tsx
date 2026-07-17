import { getBookingPageData } from "@/server/booking-data";

import { BookingWizard } from "./_components/booking-wizard";

// メニュー・営業時間はDBの内容を毎回取得する(ビルド時の静的生成はしない)
export const dynamic = "force-dynamic";

export default async function BookingPage({
  searchParams,
}: {
  searchParams: Promise<{ change?: string | string[] }>;
}) {
  const { change } = await searchParams;
  const data = await getBookingPageData();
  // ?change=<予約ID> があればウィザードを変更モードで起動する(M3)
  return (
    <BookingWizard
      data={data}
      changeReservationId={
        typeof change === "string" && change !== "" ? change : undefined
      }
    />
  );
}
