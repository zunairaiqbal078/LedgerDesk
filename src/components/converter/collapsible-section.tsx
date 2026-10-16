"use client";

import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

export function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
  className,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={cn("side-block border-t border-[#d8e1ea] pt-3 first:border-t-0 first:pt-0", className)}>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 pb-2 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="side-title text-[12.5px] font-extrabold uppercase tracking-[0.08em] text-[#17212b]">
          {title}
        </span>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-[#667788] transition", open && "rotate-180")}
        />
      </button>
      {open ? <div className="space-y-2.5 pb-2">{children}</div> : null}
    </div>
  );
}
