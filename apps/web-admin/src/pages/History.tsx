import { NotConnected, PageHead } from '../components/ui';

export default function History() {
  return (
    <>
      <PageHead title="Lịch sử xem quảng cáo" sub="Đối soát lượt phát theo thiết bị, chiến dịch và trạng thái." />
      <NotConnected what="Nhật ký lượt xem (proof-of-play)" />
    </>
  );
}
