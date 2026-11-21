import { useEffect, useRef, type ReactNode } from 'react';

/** Native <dialog> modal (keeps prototype `.dlg` look, focus-trap and Esc from the browser). */
export type DialogSize = 'sm' | 'md' | 'lg' | 'xl' | 'wiz';
/** Kích thước chuẩn (desktop): sm 640px, md 960px/90vw (mặc định), lg 1120px/92vw, xl min(1280px, 94vw). 'wiz' = trình hướng dẫn gần toàn màn hình (đầu/chân cố định). Màn hẹp: gần toàn chiều rộng, một cột. */
export function Dialog({ open, onClose, children, width, label, size = 'md' }: { open: boolean; onClose: () => void; children: ReactNode; width?: string; label?: string; size?: DialogSize }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    }
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={`dlg ${size}`} aria-label={label} style={width ? { width } : undefined} onClose={onClose} onCancel={onClose}>
      {open ? (size === 'wiz' ? children : <div className="dlg-body">{children}</div>) : null}
    </dialog>
  );
}
