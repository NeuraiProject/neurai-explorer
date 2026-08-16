'use client';

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { isNavItemActive, NAV_ITEMS } from "@/lib/nav";

const baseClassName =
  "relative py-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground";
const activeClassName =
  "text-primary font-semibold after:absolute after:left-0 after:right-0 after:-bottom-[21px] after:h-0.5 after:bg-primary";

export default function HeaderNav({ className }: { className?: string }) {
  const pathname = usePathname();

  return (
    <div className={cn("flex gap-6 items-center mr-auto ml-6", className)}>
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
