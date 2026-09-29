import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/cn";

export function Dialog({
  open,
  title,
  description,
  children,
  footer,
  onClose,
  className
}: {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className={cn("dialog max-w-xl", className)}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="dialog-header">
          <div>
            <h3 className="dialog-title">{title}</h3>
            {description && <p className="mt-1 text-sm leading-5 text-slate-500">{description}</p>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close dialog" title="Close">
            <X size={17}/>
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="border-t border-[var(--border)] bg-slate-50 px-5 py-4">{footer}</div>}
      </section>
    </div>
  );
}
