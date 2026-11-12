import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { deviceSchema } from '../api/schemas';
import { useAct } from '../api/hooks';
import { useAuth } from '../auth/AuthProvider';
import { ServerTable } from '../components/ServerTable';
import { deviceCols, DeviceDrawer } from './Devices';
import { Note, PageHead } from '../components/ui';

/** Commission control = devices that are not verified (checking / blocked). */
export default function Integrity() {
  const { can } = useAuth();
  const act = useAct();
  const [sp, setSp] = useSearchParams();
  const canWrite = can('devices', 'write') || can('finance', 'write');
  return (
    <>
      <PageHead title="Kiểm soát hoa hồng" sub="Chỉ ghi nhận lượt xem từ TV thật có tín hiệu thiết bị đáng tin cậy." />
      <Note>Thiết bị giả lập, giả mạo model hoặc thiếu chứng thực phần cứng Ed25519 bị loại khỏi lượt xem tính hoa hồng. Khoản đang chờ rà soát được giữ lại.</Note>
      <ServerTable id="ig" endpoint="/admin/v1/devices" itemSchema={deviceSchema} cols={deviceCols(false)} title="Thiết bị cần kiểm tra" exportName="rasoat" onOpen={(r) => setSp({ open: r.id })}
        filters={[{ key: 'status', label: 'Trạng thái', options: [{ value: 'checking', label: 'Đang kiểm tra' }, { value: 'blocked', label: 'Bị loại trừ' }] }]}
        extra={{ review: 1 }}
        bulk={canWrite ? [{ key: 'verify', label: 'Xác minh' }, { key: 'block', label: 'Chặn', tone: 'd' }] : []}
        onBulk={(k, ids, done) => void act(() => api.post('/admin/v1/devices/bulk', { body: { action: k, ids } }), 'Đã cập nhật.').then(done)} />
      <DeviceDrawer id={sp.get('open')} onClose={() => setSp({})} canWrite={canWrite} />
    </>
  );
}
