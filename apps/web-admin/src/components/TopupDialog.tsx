import { useEffect, useMemo, useState } from 'react';
import { Dialog } from './Dialog';
import { CopyBtn } from './ui';
import { useT } from '../i18n';
import { MIN_TOPUP_VND, qrUrl, transferContent } from '../lib/sepay';
import { vnd } from '../lib/format';

export interface BankInfo { bank: string; account_number: string; account_holder: string; prefix: string }
export interface CustomerOpt { id: string; code: string; name: string }
export interface TopupSubmit { customer_id: string; amount_vnd: number; method: string }

export interface TopupDialogProps {
  open: boolean;
  onClose: () => void;
  /** admin picks a customer; external accounts pass `fixed` */
  customers?: CustomerOpt[];
  fixed?: CustomerOpt | null;
  bank: BankInfo | null;
  onSubmit: (v: TopupSubmit) => Promise<void> | void;
  /** only offered when the API reports dev mode */
  onSimulate?: ((v: TopupSubmit & { content: string }) => Promise<void> | void) | null;
}

export function TopupDialog({ open, onClose, customers = [], fixed, bank, onSubmit, onSimulate }: TopupDialogProps) {
  const t = useT();
  const [cid, setCid] = useState('');
  const [amount, setAmount] = useState(50_000_000);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setErr(''); setCid(fixed?.id ?? customers[0]?.id ?? ''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const cust = fixed ?? customers.find((c) => c.id === cid) ?? null;
  const content = cust && bank ? transferContent(bank.prefix, cust.code) : '';
  const qr = useMemo(() => (bank && cust ? qrUrl({ account: bank.account_number, bank: bank.bank, amount, content }) : ''), [bank, cust, amount, content]);
  const valid = amount >= MIN_TOPUP_VND;
  const submit = async (fn: (v: never) => unknown, label: string) => {
    if (!cust) return setErr('Chọn khách hàng.');
    if (!valid) return setErr(`Số tiền tối thiểu ${vnd(MIN_TOPUP_VND)}.`);
    setBusy(true); setErr('');
    try { await (fn as (v: TopupSubmit & { content: string }) => unknown)({ customer_id: cust.id, amount_vnd: amount, method: label, content }); onClose(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onClose={onClose} width="min(800px,96vw)" label="Nạp tiền vào ví quảng cáo">
      <form noValidate onSubmit={(e) => { e.preventDefault(); void submit(onSubmit as never, 'qr'); }} style={{ padding: '18px 22px' }}>
        <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>Nạp tiền vào ví quảng cáo</h2>
        <div className="tp-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.15fr)', gap: 18, alignItems: 'start' }}>
          <div>
            <div className="fd" style={{ marginTop: 0 }}>
              <label htmlFor="tp-c">Khách hàng</label>
              {fixed ? <b>{fixed.name} · {fixed.code}</b> : (
                <select id="tp-c" value={cid} onChange={(e) => setCid(e.target.value)}>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.code}</option>)}
                </select>
              )}
            </div>
            <div className="fd" style={{ margin: '10px 0' }}>
              <label htmlFor="tp-a">Số tiền (₫, tối thiểu 5.000.000)</label>
              <input id="tp-a" type="number" min={MIN_TOPUP_VND} step={1_000_000} value={amount} onChange={(e) => setAmount(+e.target.value)} />
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[5, 20, 50, 100, 200].map((m) => <button key={m} type="button" className="btn sm" style={{ padding: '0 10px' }} onClick={() => setAmount(m * 1e6)}>{m} tr</button>)}
              </div>
            </div>
            <div className="fd" style={{ margin: '10px 0 0' }}>
              <label htmlFor="tp-m">Phương thức</label>
              <select id="tp-m" defaultValue="qr">
                <option value="qr">Chuyển khoản QR (tự động)</option>
                <option value="vnpay" disabled>VNPay (chưa tích hợp)</option>
                <option value="momo" disabled>MoMo (chưa tích hợp)</option>
                <option value="napas" disabled>Thẻ nội địa Napas (chưa tích hợp)</option>
              </select>
            </div>
            <p className="sub" style={{ margin: '12px 0 0', fontSize: 12.5, lineHeight: 1.5 }}>Quét mã bằng app ngân hàng, số tiền và nội dung đã điền sẵn. Khi ngân hàng báo có, ví tự cộng và quảng cáo chờ nạp tiền tự chạy.</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '150px minmax(0,1fr)', gap: 12, alignItems: 'start', background: 'var(--bg)', borderRadius: 12, padding: 12 }}>
            {bank && qr ? <img src={qr} alt="QR chuyển khoản" width={150} height={150} style={{ borderRadius: 8, background: '#fff', objectFit: 'contain' }} /> : <div style={{ width: 150, height: 150, borderRadius: 8, background: 'var(--card)', display: 'grid', placeItems: 'center', color: 'var(--mut)', fontSize: 12, textAlign: 'center', padding: 8 }}>Chưa cấu hình tài khoản nhận</div>}
            <div style={{ display: 'grid', gap: 6, fontSize: 13, minWidth: 0 }}>
              <div><span className="lab">Ngân hàng</span><br /><b>{bank?.bank ?? '—'}</b></div>
              <div><span className="lab">Số tài khoản</span><br /><b className="mono">{bank?.account_number ?? '—'}</b>{bank ? <> <CopyBtn text={bank.account_number} label="Chép" /></> : null}</div>
              <div><span className="lab">Chủ tài khoản</span><br /><b style={{ overflowWrap: 'anywhere' }}>{bank?.account_holder ?? '—'}</b></div>
              <div><span className="lab">Nội dung (đúng cú pháp)</span><br /><b className="mono" data-testid="topup-content">{content || '—'}</b>{content ? <> <CopyBtn text={content} label="Chép" /></> : null}</div>
            </div>
          </div>
        </div>
        {err ? <p role="alert" style={{ color: 'var(--bad)', margin: '10px 0 0' }}>{err}</p> : null}
        <div className="da" style={{ marginTop: 14 }}>
          <button className="btn" type="button" onClick={onClose}>{t('Hủy')}</button>
          {onSimulate ? <button className="btn" type="button" disabled={busy} onClick={() => void submit(onSimulate as never, 'simulate')}>Mô phỏng đã nhận tiền</button> : null}
          <button className="btn p" type="submit" disabled={busy || !bank}>Đã chuyển khoản</button>
        </div>
      </form>
    </Dialog>
  );
}
