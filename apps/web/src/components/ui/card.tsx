import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border border-[#e4e7ec] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.02)]", className)} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("border-b border-[#e4e7ec] px-6 py-5", className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-base font-semibold text-[#101828]", className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("mt-1 text-sm leading-5 text-[#667085]", className)} {...props} />;
}

export function CardContent({ className, children, ...props }: HTMLAttributes<HTMLDivElement> & { children?: ReactNode }) {
  return <div className={cn("p-6", className)} {...props}>{children}</div>;
}
