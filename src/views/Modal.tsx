import { useEffect, useId, useRef, type ReactNode } from 'react';

/** A native modal <dialog>: focus trapping and Esc-to-close come from the browser. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </dialog>
  );
}
