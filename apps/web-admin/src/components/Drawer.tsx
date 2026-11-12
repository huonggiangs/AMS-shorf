import type { ReactNode } from 'react';
import { Icon } from './Icon';

export function Drawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="drw" onClick={onClose}>
      <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="ib" style={{ float: 'right' }} onClick={onClose} aria-label="close">
          <Icon n="x" />
        </button>
        {children}
      </div>
    </div>
  );
}
