/** Dong gia hop dong: gia nhap dang VND thap phan, luu micro-VND nguyen (1 d = 1.000.000). Khong dung so thuc o bat ky buoc nao. */
export const MAX_MICRO = 1_000_000_000_000;

/** "33", "33,5", "0.000001" -> micro-VND nguyen; null neu khong hop le (am, 0, qua 6 chu so thap phan, qua tran). */
export function vndToMicro(input: string): number | null {
  const m = /^(\d{1,12})(?:[.,](\d{1,6}))?$/.exec(input.trim());
  if (!m) return null;
  const micro = BigInt(m[1]!) * 1_000_000n + BigInt((m[2] ?? '').padEnd(6, '0') || '0');
  if (micro <= 0n || micro > BigInt(MAX_MICRO)) return null;
  return Number(micro);
}

/** micro-VND -> chuoi VND (bo so 0 thua), vd 33_333_334 -> "33,333334". */
export function microToVnd(micro: number): string {
  const s = BigInt(Math.round(micro));
  const whole = (s / 1_000_000n).toString();
  const frac = (s % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${frac ? `,${frac}` : ''}`;
}

/** CPM -> don gia moi luot, lam tron LEN (cung quy tac may chu). */
export const cpmToUnitMicro = (cpmMicro: number): number => Math.floor((cpmMicro + 999) / 1000);

export interface LineForm { screen_type: string; daypart: string; region_id: string; model: 'fixed' | 'cpm'; price: string; effective_from: string; effective_to: string; frequency: string; duration_s: string; qty: string }
export const emptyLineForm = (): LineForm => ({ screen_type: '', daypart: '', region_id: '', model: 'fixed', price: '', effective_from: '', effective_to: '', frequency: '', duration_s: '', qty: '1' });

const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** Kiem tra phia client (may chu van kiem lai). Tra ve thong bao tieng Viet hoac { body }. */
export function lineFormToBody(f: LineForm, term: { start?: string | null; end?: string | null }): { error: string } | { body: Record<string, unknown> } {
  const micro = vndToMicro(f.price);
  if (micro === null) return { error: f.price.trim() ? 'Giá không hợp lệ: nhập số lớn hơn 0, tối đa 6 chữ số thập phân và không quá 1.000.000 ₫.' : 'Nhập giá cho dòng hợp đồng.' };
  if (f.region_id.trim().length > 16) return { error: 'Mã khu vực tối đa 16 ký tự.' };
  if (f.effective_from && !isDay(f.effective_from)) return { error: 'Ngày bắt đầu hiệu lực không hợp lệ.' };
  if (f.effective_to && !isDay(f.effective_to)) return { error: 'Ngày kết thúc hiệu lực không hợp lệ.' };
  if (f.effective_from && f.effective_to && f.effective_to < f.effective_from) return { error: 'Ngày kết thúc hiệu lực phải sau hoặc bằng ngày bắt đầu.' };
  if ((f.effective_from && term.start && f.effective_from < term.start) || (f.effective_to && term.end && f.effective_to > term.end)) return { error: 'Ngày hiệu lực của dòng giá phải nằm trong thời hạn hợp đồng.' };
  const int = (s: string, lo: number, hi: number): number | null | 'bad' => { if (!s.trim()) return null; const n = Number(s); return Number.isInteger(n) && n >= lo && n <= hi ? n : 'bad'; };
  const freq = int(f.frequency, 0, 100000);
  const dur = int(f.duration_s, 1, 600);
  const qty = int(f.qty || '1', 1, 1_000_000);
  if (freq === 'bad') return { error: 'Tần suất phải là số nguyên từ 0 đến 100.000.' };
  if (dur === 'bad') return { error: 'Thời lượng phải là số nguyên giây từ 1 đến 600.' };
  if (qty === 'bad' || qty === null) return { error: 'Số lượng phải là số nguyên từ 1 đến 1.000.000.' };
  return {
    body: {
      screen_type: f.screen_type || null, daypart: f.daypart || null, region_id: f.region_id.trim() || null, frequency: freq, duration_s: dur, qty,
      price_model: f.model, price_micro_vnd: micro, effective_from: f.effective_from || null, effective_to: f.effective_to || null,
    },
  };
}
