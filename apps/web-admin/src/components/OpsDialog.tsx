import { useEffect, useRef, type ReactNode } from 'react';

/** Hộp thoại riêng của nhóm Thiết bị/TV (native <dialog>, giữ giao diện `.dlg`); không dùng chung với Dialog để tránh ràng buộc khi Dialog thay đổi. */
export function OpsDialog({ open, onClose, children, width, label }: { open: boolean; onClose: () => void; children: ReactNode; width?: string; label: string }) {
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
