// Bo chuyen doi nha cung cap hoa don dien tu (ND 123/2020): issue / cancel / adjust / fetchStatus.
//  - 'manual' (mac dinh): ke toan xuat tren cong nha cung cap roi nhap so vao AMS (hanh vi einvoice_ref hien tai).
//  - 'misa' (MISA meInvoice) / 'viettel' (Viettel S-Invoice): KHUNG gui HTTP. KHONG co thong tin xac thuc that trong ma; khoa lay tu bien moi truong,
//    duong dan va anh xa truong la CHO TRONG phai doi chieu tai lieu ky thuat cua nha cung cap + ke toan truoc khi bat (xem docs/legal/README.md).
//  - Moi goi mang deu mang khoa idempotency (header Idempotency-Key + truong trong thong diep) va chu ky yeu cau (cho trong: HMAC-SHA256 hex).
import { hmacSha256Hex } from '@ams/shared';
import type { EinvoiceKind } from '@ams/shared';

export interface EinvoiceBuyer {
  legal_name: string;
  tax_code: string | null;
  address: string | null;
  email: string | null;
}
export interface EinvoiceRef {
  einvoice_no: string | null;
  series: string | null;
  lookup_code: string | null;
  provider_ref: string | null;
  issue_date: string | null;
}
export interface EinvoiceRequest {
  idempotencyKey: string;
  kind: EinvoiceKind;
  invoiceId: string;
  period: string;
  buyer: EinvoiceBuyer;
  /** so tien (am voi chung tu dieu chinh giam), da tach VAT */
  amount_vnd: number;
  vat_rate: number;
  vat_vnd: number;
  total_vnd: number;
  series?: string | null;
  templateCode?: string | null;
  reason?: string | null;
  /** chung tu goc (bat buoc voi adjustment/cancellation) */
  original?: EinvoiceRef | null;
  /** manual: so hoa don ke toan da xuat (neu co) */
  manualRef?: string | null;
}
export interface EinvoiceResult {
  status: 'issued' | 'pending' | 'cancelled' | 'failed';
  einvoice_no: string | null;
  series: string | null;
  lookup_code: string | null;
  provider_ref: string | null;
  issue_date: string | null;
  tax_authority_code: string | null;
}
export interface EinvoiceStatusResult {
  status: 'issued' | 'pending' | 'cancelled' | 'failed';
  tax_authority_code: string | null;
  message?: string;
}

/** Loi tam thoi (mang, 5xx, 429): thu lai theo lich lui. */
export class EinvoiceTransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EinvoiceTransientError';
  }
}
/** Nha cung cap tu choi du lieu (4xx): khong thu lai, can nguoi sua (MST sai, thieu truong...). */
export class EinvoiceRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EinvoiceRejectedError';
  }
}
/** Chua cau hinh/khong ho tro: khong goi mang. */
export class EinvoiceConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EinvoiceConfigError';
  }
}

export interface EinvoiceProvider {
  readonly id: 'manual' | 'misa' | 'viettel';
  /** manual: viec phat hanh do nguoi (ke toan) lam ngoai he thong */
  readonly interactive: boolean;
  issue(req: EinvoiceRequest): Promise<EinvoiceResult>;
  cancel(req: EinvoiceRequest): Promise<EinvoiceResult>;
  adjust(req: EinvoiceRequest): Promise<EinvoiceResult>;
  fetchStatus(ref: EinvoiceRef): Promise<EinvoiceStatusResult>;
}

// ---------------- manual ----------------
export const manualProvider: EinvoiceProvider = {
  id: 'manual',
  interactive: true,
  async issue(req) {
    // co so tu ke toan -> da phat hanh; chua co -> cho nhap (khong coi la loi)
    if (req.manualRef) return { status: 'issued', einvoice_no: req.manualRef, series: req.series ?? null, lookup_code: null, provider_ref: null, issue_date: null, tax_authority_code: null };
    return { status: 'pending', einvoice_no: null, series: null, lookup_code: null, provider_ref: null, issue_date: null, tax_authority_code: null };
  },
  async cancel(req) {
    return { status: 'pending', einvoice_no: null, series: null, lookup_code: null, provider_ref: null, issue_date: null, tax_authority_code: req.original?.einvoice_no ?? null };
  },
  async adjust(req) {
    if (req.manualRef) return { status: 'issued', einvoice_no: req.manualRef, series: req.series ?? null, lookup_code: null, provider_ref: null, issue_date: null, tax_authority_code: null };
    return { status: 'pending', einvoice_no: null, series: null, lookup_code: null, provider_ref: null, issue_date: null, tax_authority_code: null };
  },
  async fetchStatus() {
    return { status: 'pending', tax_authority_code: null, message: 'Chế độ thủ công: không có cổng nhà cung cấp để tra cứu.' };
  },
};

// ---------------- khung HTTP dung chung (MISA / Viettel) ----------------
export interface HttpProviderConfig {
  baseUrl: string;
  sandbox: boolean;
  /** bi mat ky yeu cau; rong => EinvoiceConfigError (khong gui) */
  signingSecret: string;
  /** dinh danh ben ban (app id / ten dang nhap); khong duoc ghi log */
  clientId: string;
  sellerTaxCode: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export type ProviderOp = 'issue' | 'cancel' | 'adjust' | 'status';
interface Endpoints {
  /** CHO TRONG: duong dan theo tai lieu nha cung cap. */
  paths: Record<ProviderOp, string>;
  /** Anh xa yeu cau noi bo -> than JSON cua nha cung cap. CHO TRONG: kiem lai voi tai lieu + ke toan. */
  toBody(op: ProviderOp, req: EinvoiceRequest | EinvoiceRef, cfg: HttpProviderConfig): Record<string, unknown>;
  /** Doc phan hoi thanh cong. */
  fromBody(op: ProviderOp, body: Record<string, unknown>): EinvoiceResult;
}

const asStr = (v: unknown): string | null => (typeof v === 'string' && v ? v : typeof v === 'number' ? String(v) : null);

/** Chu ky yeu cau CHO TRONG: HMAC-SHA256(thoi diem + than JSON). Nha cung cap that co the dung RSA/JWT/token: thay o day. */
export async function signPlaceholder(secret: string, timestamp: string, body: string): Promise<string> {
  return hmacSha256Hex(secret, `${timestamp}.${body}`);
}

class HttpEinvoiceProvider implements EinvoiceProvider {
  readonly interactive = false;
  constructor(readonly id: 'misa' | 'viettel', private cfg: HttpProviderConfig, private ep: Endpoints, private now: () => Date) {}

  private async call(op: ProviderOp, payload: EinvoiceRequest | EinvoiceRef, idempotencyKey: string): Promise<ReturnType<Endpoints['fromBody']>> {
    if (!this.cfg.signingSecret || !this.cfg.clientId || !this.cfg.baseUrl) throw new EinvoiceConfigError(`Chưa cấu hình thông tin kết nối ${this.id === 'misa' ? 'MISA meInvoice' : 'Viettel S-Invoice'} (biến môi trường).`);
    const body = JSON.stringify(this.ep.toBody(op, payload, this.cfg));
    const ts = this.now().toISOString();
    const f = this.cfg.fetchFn ?? fetch;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.cfg.timeoutMs ?? 15_000);
    let res: Response;
    try {
      res = await f(`${this.cfg.baseUrl.replace(/\/+$/, '')}${this.ep.paths[op]}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
          'X-Client-Id': this.cfg.clientId,
          'X-Timestamp': ts,
          'X-Signature': await signPlaceholder(this.cfg.signingSecret, ts, body),
          'X-Sandbox': this.cfg.sandbox ? '1' : '0',
        },
        body,
        signal: ctl.signal,
      });
    } catch (e) {
      throw new EinvoiceTransientError(`Không kết nối được nhà cung cấp (${(e as Error).name}).`);
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      /* than khong phai JSON */
    }
    if (res.status === 429 || res.status >= 500) throw new EinvoiceTransientError(`Nhà cung cấp tạm thời lỗi (HTTP ${res.status}).`);
    if (res.status >= 400) throw new EinvoiceRejectedError(`Nhà cung cấp từ chối (HTTP ${res.status}): ${asStr(json['message']) ?? asStr(json['error']) ?? 'không rõ lý do'}`.slice(0, 300));
    return this.ep.fromBody(op, json);
  }

  issue(req: EinvoiceRequest) {
    return this.call('issue', req, req.idempotencyKey) as Promise<EinvoiceResult>;
  }
  cancel(req: EinvoiceRequest) {
    return this.call('cancel', req, req.idempotencyKey) as Promise<EinvoiceResult>;
  }
  adjust(req: EinvoiceRequest) {
    return this.call('adjust', req, req.idempotencyKey) as Promise<EinvoiceResult>;
  }
  async fetchStatus(ref: EinvoiceRef): Promise<EinvoiceStatusResult> {
    const r = await this.call('status', ref, `status:${ref.provider_ref ?? ref.einvoice_no ?? ''}`);
    return { status: r.status, tax_authority_code: r.tax_authority_code };
  }
}

const commonFromBody = (keys: { no: string; series: string; lookup: string; ref: string; date: string; cqt: string; state?: string }): Endpoints['fromBody'] => (_op, b) => {
  const st = asStr(b[keys.state ?? 'status']);
  return {
    status: st === 'cancelled' ? 'cancelled' : st === 'failed' ? 'failed' : asStr(b[keys.no]) ? 'issued' : 'pending',
    einvoice_no: asStr(b[keys.no]),
    series: asStr(b[keys.series]),
    lookup_code: asStr(b[keys.lookup]),
    provider_ref: asStr(b[keys.ref]),
    issue_date: asStr(b[keys.date]),
    tax_authority_code: asStr(b[keys.cqt]),
  };
};

const lineOf = (r: EinvoiceRequest) => ({ name: `Dịch vụ quảng cáo ${r.period}`, amount: r.amount_vnd, vat_rate: r.vat_rate, vat_amount: r.vat_vnd, total: r.total_vnd });
const isReq = (x: EinvoiceRequest | EinvoiceRef): x is EinvoiceRequest => 'idempotencyKey' in x;

// CHO TRONG: ten truong/duong dan MISA meInvoice. Doi chieu tai lieu tich hop MISA truoc khi bat.
const MISA: Endpoints = {
  paths: { issue: '/api/v1/invoices/issue', cancel: '/api/v1/invoices/cancel', adjust: '/api/v1/invoices/adjust', status: '/api/v1/invoices/status' },
  toBody: (op, x, cfg) => (isReq(x)
    ? { RefID: x.idempotencyKey, SellerTaxCode: cfg.sellerTaxCode, Buyer: x.buyer, Items: [lineOf(x)], Series: x.series ?? null, TemplateCode: x.templateCode ?? null, Reason: x.reason ?? null, Original: x.original ?? null, Operation: op }
    : { SellerTaxCode: cfg.sellerTaxCode, TransactionID: x.provider_ref, InvoiceNo: x.einvoice_no }),
  fromBody: commonFromBody({ no: 'InvoiceNo', series: 'InvoiceSeries', lookup: 'LookupCode', ref: 'TransactionID', date: 'InvoiceDate', cqt: 'TaxAuthorityCode' }),
};
// CHO TRONG: ten truong/duong dan Viettel S-Invoice.
const VIETTEL: Endpoints = {
  paths: { issue: '/InvoiceAPI/InvoiceWS/createInvoice', cancel: '/InvoiceAPI/InvoiceWS/cancelTransactionInvoice', adjust: '/InvoiceAPI/InvoiceWS/createInvoice', status: '/InvoiceAPI/InvoiceUtilsWS/getInvoiceStatus' },
  toBody: (op, x, cfg) => (isReq(x)
    ? { generalInvoiceInfo: { transactionUuid: x.idempotencyKey, invoiceSeries: x.series ?? null, templateCode: x.templateCode ?? null, adjustmentType: x.kind === 'adjustment' ? '5' : '1', originalInvoiceId: x.original?.einvoice_no ?? null, adjustmentReason: x.reason ?? null, operation: op }, sellerTaxCode: cfg.sellerTaxCode, buyerInfo: x.buyer, itemInfo: [lineOf(x)] }
    : { supplierTaxCode: cfg.sellerTaxCode, transactionUuid: x.provider_ref, invoiceNo: x.einvoice_no }),
  fromBody: commonFromBody({ no: 'invoiceNo', series: 'invoiceSeries', lookup: 'reservationCode', ref: 'transactionID', date: 'issueDate', cqt: 'codeOfTax' }),
};

export interface EinvoiceSettings {
  provider: 'manual' | 'misa' | 'viettel';
  /** moi truong thu nghiem cua nha cung cap (khong co gia tri phap ly) */
  sandbox: boolean;
  series: string;
  template_code: string;
  /** gui nha cung cap ngay khi hoa don noi bo duoc phat hanh (chi khi provider khac manual) */
  auto_issue: boolean;
  /** tu tao hoa don dieu chinh khi hoan tien da chi */
  auto_adjust_on_refund: boolean;
}
export const EINVOICE_SETTINGS_KEY = 'einvoice';
export const DEFAULT_EINVOICE: EinvoiceSettings = { provider: 'manual', sandbox: true, series: '', template_code: '', auto_issue: false, auto_adjust_on_refund: true };

/** Doc bien moi truong; tra ve cau hinh + co da du hay chua. Khong bao gio tra gia tri bi mat ra ngoai. */
export function providerConfigFromEnv(env: Record<string, string | undefined>, id: 'misa' | 'viettel', sandbox: boolean): HttpProviderConfig {
  const P = id === 'misa' ? 'EINVOICE_MISA_' : 'EINVOICE_VIETTEL_';
  const base = (sandbox ? env[`${P}SANDBOX_URL`] : env[`${P}BASE_URL`]) ?? '';
  return { baseUrl: base, sandbox, signingSecret: env[`${P}SECRET`] ?? '', clientId: env[`${P}CLIENT_ID`] ?? '', sellerTaxCode: env[`${P}SELLER_TAX_CODE`] ?? '' };
}
export const providerConfigured = (c: HttpProviderConfig): boolean => !!(c.baseUrl && c.signingSecret && c.clientId && c.sellerTaxCode);

export function createProvider(s: EinvoiceSettings, env: Record<string, string | undefined>, now: () => Date, fetchFn?: typeof fetch): EinvoiceProvider {
  if (s.provider === 'manual') return manualProvider;
  const cfg = { ...providerConfigFromEnv(env, s.provider, s.sandbox), ...(fetchFn ? { fetchFn } : {}) };
  return new HttpEinvoiceProvider(s.provider, cfg, s.provider === 'misa' ? MISA : VIETTEL, now);
}
