import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { quoteSchema, type Quote } from '../api/schemas';
import { num } from '../lib/format';
import { Note } from './ui';

const DAYPART: Record<string, string> = { peak: 'Giờ cao điểm (17:00–22:00)', off_peak: 'Giờ thường' };
const SCREEN: Record<string, string> = { tv: 'TV', elevator: 'Thang máy', led_p5: 'LED' };

/** Bảng báo giá hiển thị cho khách TRƯỚC khi gửi duyệt (giá đã chốt sau khi duyệt). Khách không thấy giá sàn/nguồn giá. */
export function QuoteTable({ quote }: { quote: Quote }) {
  if (quote.status === 'unavailable') return <Note warn>{quote.message ?? 'Chưa có bảng giá cho loại màn hình này.'}</Note>;
  const regional = quote.lines.filter((l) => l.region_id !== '*');
  const general = quote.lines.filter((l) => l.region_id === '*');
  return (
    <div role="region" aria-label="Báo giá" style={{ margin: '10px 0 0', fontSize: 13 }}>
      <b>{quote.locked ? 'Giá đã chốt khi duyệt (không đổi khi bảng giá thay đổi)' : 'Báo giá theo bảng giá hiện hành (chốt khi duyệt)'}</b>
      <table style={{ width: '100%', marginTop: 4, borderCollapse: 'collapse' }}>
        <tbody>
          {general.map((l) => (
            <tr key={`${l.screen_type}-${l.daypart}`}>
              <td>{SCREEN[l.screen_type] ?? l.screen_type} · {DAYPART[l.daypart] ?? l.daypart}</td>
              <td style={{ textAlign: 'right' }}><b>{l.unit_price_vnd} ₫</b>/lượt</td>
              <td style={{ textAlign: 'right' }}>{l.estimated_impressions ? `≈ ${num(l.estimated_impressions)} lượt` : ''}</td>
            </tr>
          ))}
          {regional.map((l) => (
            <tr key={`${l.screen_type}-${l.region_id}-${l.daypart}`}>
              <td>{SCREEN[l.screen_type] ?? l.screen_type} · {l.region_id} · {DAYPART[l.daypart] ?? l.daypart}</td>
              <td style={{ textAlign: 'right' }}><b>{l.unit_price_vnd} ₫</b>/lượt</td>
              <td style={{ textAlign: 'right' }}>{l.estimated_impressions ? `≈ ${num(l.estimated_impressions)} lượt` : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ margin: '4px 0 0', color: 'var(--mut, #666)' }}>
        Số lượt ước tính theo ngân sách, không phải cam kết. Chi phí thực tế tính theo số lượt hiển thị hợp lệ do hệ thống AMS ghi nhận.
        {quote.placeholder ? ' Đang dùng giá tạm (chưa có bảng giá chính thức).' : ''}
      </p>
    </div>
  );
}

export function PriceQuote({ path, query, enabled = true }: { path: string; query?: Record<string, string | number | undefined>; enabled?: boolean }) {
  const q = useQuery({ queryKey: [path, 'quote', query], enabled, queryFn: () => api.get(path, { query, schema: quoteSchema }) });
  if (!enabled) return null;
  if (q.isLoading) return <p style={{ fontSize: 13 }}>Đang tải báo giá…</p>;
  if (q.isError || !q.data) return <Note warn>Không tải được báo giá.</Note>;
  return <QuoteTable quote={q.data} />;
}
