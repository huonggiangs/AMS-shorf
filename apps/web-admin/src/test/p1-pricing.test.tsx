import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QuoteTable } from '../components/PriceQuote';
import type { Quote } from '../api/schemas';

const line = (daypart: string, vnd: string, micro: number, extra: Record<string, unknown> = {}) => ({ screen_type: 'tv', region_id: '*', daypart, unit_price_micro_vnd: micro, unit_price_vnd: vnd, model: 'per_impression', estimated_impressions: 125000, ...extra });

describe('p1-pricing web: bao gia truoc khi gui', () => {
  it('hien don gia moi khung gio + so luot uoc tinh; khong hien gia san/nguon', () => {
    const q = { status: 'quoted', locked: false, placeholder: false, budget_vnd: 5_000_000, lines: [line('peak', '40', 40_000_000), line('off_peak', '25.5', 25_500_000, { estimated_impressions: 196078 })] } as Quote;
    const { container } = render(<QuoteTable quote={q} />);
    expect(screen.getByRole('region', { name: 'Báo giá' })).toBeTruthy();
    expect(container.textContent).toContain('40 ₫');
    expect(container.textContent).toContain('25.5 ₫');
    expect(container.textContent).toContain('Giờ cao điểm');
    expect(container.textContent).toMatch(/không phải cam kết/);
    expect(container.textContent).not.toMatch(/sàn|floor/i);
  });
  it('gia da chot sau duyet va thieu bang gia', () => {
    const locked = render(<QuoteTable quote={{ status: 'locked', locked: true, placeholder: false, lines: [line('peak', '40', 40_000_000)] } as Quote} />);
    expect(locked.container.textContent).toContain('Giá đã chốt khi duyệt');
    locked.unmount();
    const none = render(<QuoteTable quote={{ status: 'unavailable', locked: false, placeholder: false, message: 'Chưa có bảng giá cho: TV / giờ thường.', lines: [] } as Quote} />);
    expect(none.container.textContent).toContain('Chưa có bảng giá');
  });
});
