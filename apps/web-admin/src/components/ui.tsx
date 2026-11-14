import { cloneElement, isValidElement, useId, useState, type ReactElement, type ReactNode, type ButtonHTMLAttributes } from 'react';
import { Icon } from './Icon';
import { useT } from '../i18n';
import { useUi } from '../state/ui';
import { statusInfo, type Tone } from '../lib/status';
import { errMsg } from '../api/client';

export function Tag({ tone = 'info', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`tag ${tone}`}>{children}</span>;
}
export function StatusTag({ status }: { status: string | null | undefined }) {
  const { label, tone } = statusInfo(status);
  return <Tag tone={tone}>{label}</Tag>;
}

export function Note({ children, warn = false }: { children: ReactNode; warn?: boolean }) {
  return (
    <div className="note" style={warn ? { background: 'var(--warn-t)' } : undefined}>
      <Icon n={warn ? 'warn' : 'info'} />
      <span>{children}</span>
    </div>
  );
}

export function Kpi({ label, value, foot, icon, unit }: { label: string; value: ReactNode; foot?: ReactNode; icon: string; unit?: string }) {
  const t = useT();
  return (
    <div className="card kpi">
      <div className="l">
        <span style={{ display: 'grid', placeItems: 'center', background: 'var(--pri-t)', color: 'var(--pri)' }}>
          <Icon n={icon} />
        </span>
        <div style={{ flex: 1, textAlign: 'right' }}>{t(label)}</div>
      </div>
      <b>
        {value}
        {unit ? <em>{unit}</em> : null}
      </b>
      <small>{foot}</small>
    </div>
  );
}

export function PageHead({ title, sub, actions, eyebrow }: { title: string; sub?: string; actions?: ReactNode; eyebrow?: string }) {
  const t = useT();
  return (
    <div className="hd">
      <div>
        {eyebrow ? (
          <span className="eyebrow">
            <i />
            {eyebrow}
          </span>
        ) : null}
        <h1 className="t">{t(title)}</h1>
        {sub ? <p className="sub">{sub}</p> : null}
      </div>
      <div className="acts">{actions}</div>
    </div>
  );
}

export function Btn({ tone = '', icon, children, ...r }: { tone?: '' | 'p' | 'd'; icon?: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...r} className={`btn ${tone} ${r.className ?? ''}`.trim()}>
      {icon ? <Icon n={icon} /> : null}
      {children}
    </button>
  );
}

export function NameCell({ icon, a, b }: { icon: string; a: string; b?: string | null }) {
  return (
    <div className="nm">
      <span className="ico">
        <Icon n={icon} />
      </span>
      <div>
        <b>{a}</b>
        <small>{b ?? ''}</small>
      </div>
    </div>
  );
}

/** Honest placeholder states: never fake numbers. */
export function LoadingBlock({ label }: { label?: string }) {
  const t = useT();
  return (
    <div className="card cp" role="status" aria-live="polite" style={{ color: 'var(--mut)', textAlign: 'center', padding: 36 }}>
      {label ?? t('Đang tải…')}
    </div>
  );
}
export function EmptyBlock({ children }: { children?: ReactNode }) {
  const t = useT();
  return (
    <div className="card cp" style={{ color: 'var(--mut)', textAlign: 'center', padding: 36 }}>
      {children ?? t('Chưa có dữ liệu')}
    </div>
  );
}
export function ErrorBlock({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useT();
  return (
    <div className="card cp" role="alert" style={{ textAlign: 'center', padding: 28 }}>
      <p style={{ color: 'var(--bad)', margin: '0 0 12px' }}>{errMsg(error)}</p>
      {onRetry ? <Btn onClick={onRetry}>{t('Thử lại')}</Btn> : null}
    </div>
  );
}
/** Page that has no backing endpoint in the current API contract. */
export function NotConnected({ what }: { what: string }) {
  return (
    <Note warn>
      {what}: chưa có điểm cuối API tương ứng trong hợp đồng hiện tại nên chưa hiển thị số liệu. Trang sẽ tự có dữ liệu khi máy chủ cung cấp.
    </Note>
  );
}

export function CopyBtn({ text, label = 'Sao chép', small = true }: { text: string; label?: string; small?: boolean }) {
  const t = useT();
  const { notify } = useUi();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={`btn ${small ? 'sm' : ''}`}
      style={small ? { height: 26, padding: '0 8px' } : undefined}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const ta = document.createElement('textarea');
          ta.value = text;
          document.body.append(ta);
          ta.select();
          document.execCommand?.('copy');
          ta.remove();
        }
        setDone(true);
        notify(t('Đã sao chép'));
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? t('Đã sao chép') : t(label)}
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  const id = useId();
  // gan nhan voi o nhap (truy cap + kiem thu): chi khi con la mot phan tu chua co id
  const child = isValidElement(children) && !(children.props as { id?: string }).id ? cloneElement(children as ReactElement<{ id?: string }>, { id }) : children;
  const linked = isValidElement(children) ? ((children.props as { id?: string }).id ?? id) : undefined;
  return (
    <div className="fd">
      <label htmlFor={linked}>{label}</label>
      {child}
      {hint ? <small style={{ color: 'var(--mut)', fontSize: 12.5 }}>{hint}</small> : null}
    </div>
  );
}

/** Segmented tab strip (prototype `.tabs`). */
export function Tabs<T extends string>({ value, items, onChange, label }: { value: T; items: { id: T; label: string }[]; onChange: (v: T) => void; label?: string }) {
  const t = useT();
  return (
    <div className="tabs" role="group" aria-label={label} style={{ marginTop: 4 }}>
      {items.map((x) => (
        <button key={x.id} type="button" className={value === x.id ? 'on' : ''} aria-pressed={value === x.id} onClick={() => onChange(x.id)}>
          {t(x.label)}
        </button>
      ))}
    </div>
  );
}
