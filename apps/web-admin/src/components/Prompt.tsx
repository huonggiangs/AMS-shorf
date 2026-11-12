import { useState } from 'react';
import { Dialog } from './Dialog';
import { useT } from '../i18n';

/** Small modal asking for one text value (e.g. reject reason). */
export function PromptDialog({ open, title, label, required = true, onClose, onSubmit }: { open: boolean; title: string; label: string; required?: boolean; onClose: () => void; onSubmit: (v: string) => void | Promise<void> }) {
  const t = useT();
  const [v, setV] = useState('');
  return (
    <Dialog open={open} onClose={onClose} label={title}>
      <form onSubmit={async (e) => { e.preventDefault(); await onSubmit(v.trim()); setV(''); onClose(); }}>
        <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>{title}</h2>
        <div className="fd" style={{ marginTop: 0 }}>
          <label htmlFor="pr-v">{label}</label>
          <textarea id="pr-v" value={v} required={required} onChange={(e) => setV(e.target.value)} />
        </div>
        <div className="da" style={{ marginTop: 14 }}>
          <button type="button" className="btn" onClick={onClose}>{t('Hủy')}</button>
          <button type="submit" className="btn p">{t('Xác nhận')}</button>
        </div>
      </form>
    </Dialog>
  );
}
