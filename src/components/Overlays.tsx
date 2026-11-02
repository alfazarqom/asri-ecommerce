import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export function Modal({ title, children, onClose, className = "" }: { title: string; children: ReactNode; onClose: () => void; className?: string }) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const items = panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])');
        if (!items?.length) { event.preventDefault(); return; }
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); previous?.focus(); };
  }, [onClose]);
  return <div className="overlay-backdrop modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={panelRef} className={`modal-card ${className}`} role="dialog" aria-modal="true" aria-labelledby="overlay-modal-title">
      <div className="modal-heading"><h2 id="overlay-modal-title">{title}</h2><button ref={closeRef} className="icon-button" onClick={onClose} aria-label="Tutup dialog"><X /></button></div>
      {children}
    </section>
  </div>;
}
