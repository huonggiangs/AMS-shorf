export const BANKS = ['Vietcombank', 'VietinBank', 'BIDV', 'Agribank', 'MBBank', 'Techcombank', 'ACB', 'VPBank', 'TPBank', 'Sacombank', 'HDBank', 'OCB', 'MSB', 'SHB', 'VIB', 'SeABank'] as const;
export const MIN_TOPUP_VND = 5_000_000;

/** Transfer content per spec §8.3: "AMS K004". */
export const transferContent = (prefix: string, code: string): string => `${prefix} ${code}`.trim();

/** VietQR via SePay: https://qr.sepay.vn/img?acc=&bank=&amount=&des= */
export const qrUrl = (o: { account: string; bank: string; amount: number; content: string }): string =>
  `https://qr.sepay.vn/img?acc=${encodeURIComponent(o.account)}&bank=${encodeURIComponent(o.bank)}&amount=${Math.max(0, Math.round(o.amount || 0))}&des=${encodeURIComponent(o.content)}`;
