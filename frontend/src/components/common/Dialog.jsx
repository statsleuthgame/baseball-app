import { useEffect, useRef, useCallback } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export default function Dialog({
  open,
  onClose,
  ariaLabel,
  ariaLabelledBy,
  className = "",
  panelClassName = "",
  children,
  initialFocusRef,
  closeOnOverlayClick = true,
}) {
  const overlayRef = useRef(null);
  const panelRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement;
    const panel = panelRef.current;
    if (!panel) return;

    // Move focus into the panel after mount.
    const toFocus =
      initialFocusRef?.current ||
      panel.querySelector(FOCUSABLE) ||
      panel;
    if (toFocus && typeof toFocus.focus === "function") {
      requestAnimationFrame(() => toFocus.focus());
    }

    return () => {
      const t = triggerRef.current;
      if (t && typeof t.focus === "function" && document.contains(t)) {
        t.focus();
      }
    };
  }, [open, initialFocusRef]);

  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose?.();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = panel.querySelectorAll(FOCUSABLE);
      if (focusables.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !panel.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose]
  );

  const handleOverlayClick = (e) => {
    if (!closeOnOverlayClick) return;
    if (e.target === overlayRef.current) onClose?.();
  };

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className={className}
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
      role="presentation"
    >
      <div
        ref={panelRef}
        className={panelClassName}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}
