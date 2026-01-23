'use client';

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { isNavItemActive, NAV_ITEMS } from "@/lib/nav";

const baseClassName =
  "text-sm font-medium text-muted-foreground transition-colors hover:text-foreground";
const activeClassName =
  "text-foreground font-semibold underline decoration-2 decoration-primary underline-offset-8";

export default function HeaderNav({ className }: { className?: string }) {
  const pathname = usePathname();

  return (
    <div className={cn("flex gap-6 items-center mr-auto", className)}>
      {NAV_ITEMS.map((item) => {
        const active = isNavItemActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(baseClassName, active && activeClassName)}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
