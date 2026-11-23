import { PageHead } from '../components/ui';
import { ViewsReport } from '../components/ViewsReport';
import { useAuth } from '../auth/AuthProvider';

/** Trang chủ của khách hàng: lượt xem quảng cáo của chính họ (số hôm nay/7/30 ngày, theo ngày, chiến dịch, địa điểm) + tải báo cáo. */
export default function Views() {
  const { isExternal } = useAuth();
  return (
    <>
      <PageHead title="Báo cáo lượt xem quảng cáo" sub="Lượt xem hợp lệ của các chiến dịch của bạn trên màn hình ANIO. Tải báo cáo PDF để gửi nội bộ hoặc đối tác." />
      <ViewsReport external={isExternal} />
    </>
  );
}
