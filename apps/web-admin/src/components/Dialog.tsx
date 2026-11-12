import { useEffect, useRef, type ReactNode } from 'react';

/** Native <dialog> modal (keeps prototype `.dlg` look, focus-trap and Esc from the browser). */
export function Dialog({ open, onClose, children, width, label }: { open: boolean; onClose: () => void; children: ReactNode; width?: string; label?: string }) {
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
    <dialog ref={ref} className="dlg" aria-label={label} style={width ? { width } : undefined} onClose={onClose} onCancel={onClose}>
      {open ? children : null}
    </dialog>
  );
}
