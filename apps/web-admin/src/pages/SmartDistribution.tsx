import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { listOf } from '../api/schemas';
import { recoHistorySchema, recommendResultSchema, type Reco, type RecommendResult } from '../api/schemasBp';
import { useAct } from '../api/hooks';
import { Btn, EmptyBlock, Field, LoadingBlock, Note, PageHead, StatusTag } from '../components/ui';
import { fmtDateTime } from '../lib/format';

const PLACES = [['building', 'Chung cư / tòa nhà'], ['office', 'Văn phòng'], ['hospital', 'Bệnh viện / phòng khám'], ['school', 'Trường học'], ['mall', 'Trung tâm thương mại'], ['restaurant', 'Nhà hàng / quán cà phê'], ['street', 'Ngoài trời / đường phố'], ['home', 'Gia đình'], ['other', 'Khác']];
const AUDIENCES = [['mixed', 'Hỗn hợp'], ['child', 'Trẻ em'], ['teen', 'Thanh thiếu niên'], ['adult', 'Người lớn'], ['senior', 'Người cao tuổi']];
const DENSITIES = [['low', 'Thưa'], ['medium', 'Vừa'], ['high', 'Đông']];
const WEATHERS = [['any', 'Không quan tâm'], ['sunny', 'Nắng'], ['rain', 'Mưa'], ['hot', 'Nóng'], ['cold', 'Lạnh']];
const label = (list: string[][], v?: string | null) => list.find((x) => x[0] === v)?.[1] ?? v ?? '—';
const ENDPOINT = '/admin/v1/broadcast-insights/recommend';

/** Phân phối thông minh: chấm điểm chương trình theo ngữ cảnh địa điểm bằng luật (không cần khóa AI), có lý do và nhóm thiết bị đích. */
export default function SmartDistribution() {
  const nav = useNavigate();
  const act = useAct();
  const [f, setF] = useState({ place: 'building', hour: String(new Date().getHours()), audience: 'mixed', density: 'medium', weather: 'any', note: '' });
  const [res, setRes] = useState<RecommendResult | null>(null);
  const [busy, setBusy] = useState(false);
  const hist = useQuery({ queryKey: [ENDPOINT], queryFn: () => api.get(ENDPOINT, { schema: listOf(recoHistorySchema) }) });
  const run = async () => {
    setBusy(true);
    const r = await act(() => api.post(ENDPOINT, { body: { ...f, hour: Number(f.hour) }, schema: recommendResultSchema }), undefined, [ENDPOINT]);
    setBusy(false);
    if (r) setRes(r);
  };
  const apply = (x: Reco) => nav(`/broadcast?program=${encodeURIComponent(x.program_id)}`);
  return (
    <>
      <PageHead eyebrow="Gợi ý theo ngữ cảnh" title="Phân phối thông minh" sub="Nhập bối cảnh địa điểm, hệ thống chấm điểm các chương trình theo luật (loại màn, khung giờ, đối tượng, thiết bị trực tuyến) và nói rõ lý do." />
      <form className="card cp" onSubmit={(e) => { e.preventDefault(); void run(); }}>
        <Field label="Loại địa điểm"><select value={f.place} onChange={(e) => setF({ ...f, place: e.target.value })}>{PLACES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        <Field label="Giờ phát (0–23)"><input type="number" min={0} max={23} value={f.hour} onChange={(e) => setF({ ...f, hour: e.target.value })} /></Field>
        <Field label="Đối tượng xem"><select value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}>{AUDIENCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        <Field label="Mật độ người"><select value={f.density} onChange={(e) => setF({ ...f, density: e.target.value })}>{DENSITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        <Field label="Thời tiết"><select value={f.weather} onChange={(e) => setF({ ...f, weather: e.target.value })}>{WEATHERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        <Field label="Ghi chú" hint="Từ khóa trùng với tên chương trình sẽ được cộng điểm (vd khuyến mãi, sáng)."><input maxLength={200} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <Btn tone="p" type="submit" disabled={busy}>{busy ? 'Đang tính…' : 'Đề xuất phân phối'}</Btn>
      </form>
      {res ? (
        <>
          <h3 style={{ margin: '18px 0 8px' }}>Kết quả đề xuất</h3>
          <Note>{res.summary}</Note>
          {!res.items.length ? <EmptyBlock>Chưa có chương trình để đề xuất.</EmptyBlock> : res.items.map((x, i) => (
            <div key={x.program_id} className="card cp" style={{ marginTop: 10 }}>
              <div className="ch">
                <div><h2>{i + 1}. {x.name}</h2><p>{x.target_type} · <StatusTag status={x.status} /> · {x.online_total}/{x.device_total} thiết bị trực tuyến</p></div>
                <div style={{ textAlign: 'right' }}><b className="mono" style={{ fontSize: 22 }}>{x.score}</b>/100<br /><Btn onClick={() => apply(x)}>Áp dụng</Btn></div>
              </div>
              {x.groups.length ? <p>Nhóm thiết bị: {x.groups.map((g) => `${g.region} (${g.online}/${g.total})`).join(' · ')}</p> : null}
              <ul>{x.reasons.map((r, k) => <li key={`r${k}`}>{r}</li>)}</ul>
              {x.warnings.length ? <Note warn>{x.warnings.join(' ')}</Note> : null}
            </div>
          ))}
          {res.media_suggestions.length ? (
            <div className="card cp" style={{ marginTop: 10 }}>
              <div className="ch"><div><h2>Tệp trong kho chưa dùng</h2><p>Có thể gom thành chương trình mới</p></div><Btn onClick={() => nav('/broadcast?new=1')}>Tạo chương trình mới</Btn></div>
              <ul>{res.media_suggestions.map((m) => <li key={m.id}>{m.name ?? m.id}{m.kid_safe ? ' · an toàn trẻ em' : ''}</li>)}</ul>
            </div>
          ) : null}
        </>
      ) : null}
      <h3 style={{ margin: '18px 0 8px' }}>Lịch sử quyết định</h3>
      {hist.isLoading ? <LoadingBlock /> : !hist.data?.items.length ? <EmptyBlock>Chưa có lần đề xuất nào.</EmptyBlock> : (
        <div className="card cp">
          <table className="tbl">
            <thead><tr><th>Lúc</th><th>Người dùng</th><th>Ngữ cảnh</th><th>Đề xuất hàng đầu</th></tr></thead>
            <tbody>{hist.data.items.map((h) => (
              <tr key={h.id}>
                <td className="mono">{fmtDateTime(h.at)}</td>
                <td>{h.actor}</td>
                <td>{label(PLACES, h.context?.place)} · {h.context?.hour ?? '—'}h · {label(AUDIENCES, h.context?.audience)} · {label(DENSITIES, h.context?.density)}</td>
                <td>{h.top?.[0] ? `${h.top[0].name} (${h.top[0].score})` : '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </>
  );
}
