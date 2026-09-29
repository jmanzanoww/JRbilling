import type { ReactNode, SelectHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export function FormField({
  label,
  hint,
  error,
  required,
  children,
  className
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="text-xs font-semibold text-slate-700">
        {label}{required && <span className="ml-0.5 text-red-600">*</span>}
      </span>
      <div className="mt-1">{children}</div>
      {error ? (
        <span className="mt-1 block text-xs text-red-600">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs leading-5 text-slate-500">{hint}</span>
      ) : null}
    </label>
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "min-h-9 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none hover:border-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 disabled:bg-slate-100",
        className
      )}
      {...props}
    />
  );
}
