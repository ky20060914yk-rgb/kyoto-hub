'use client';

import { useEffect, useRef } from 'react';
import { Icon } from './Icon';

/** Bottom sheet on mobile, centered dialog on desktop. Uses <dialog> for focus trap + Esc. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label={title}
      className="m-0 mt-auto max-h-dvh w-full max-w-none bg-transparent p-0 backdrop:bg-scrim open:animate-sheet-up md:m-auto md:max-w-content md:open:animate-fade-in"
    >
      <div className="flex max-h-[92dvh] flex-col rounded-t-l bg-surface shadow-float md:rounded-l">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-4">
          <h2 className="flex-1 text-heading">{title}</h2>
          <button onClick={onClose} className="grid size-tap place-items-center rounded-full text-ink-2 hover:bg-surface-muted" aria-label="閉じる">
            <Icon name="close" />
          </button>
        </header>
        <div className="overflow-y-auto p-4 pb-safe">{children}</div>
      </div>
    </dialog>
  );
}
