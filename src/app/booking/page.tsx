import { getBookingPageData } from "@/server/booking-data";

import { BookingWizard } from "./_components/booking-wizard";

// メニュー・営業時間はDBの内容を毎回取得する(ビルド時の静的生成はしない)
export const dynamic = "force-dynamic";

export default async function BookingPage() {
  const data = await getBookingPageData();
  return <BookingWizard data={data} />;
}
