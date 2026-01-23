'use client';

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { isNavItemActive, NAV_ITEMS } from "@/lib/nav";

const baseClassName =
  "flex items-center justify-between rounded-lg px-3 py-2 text-base font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground";
const activeClassName =
  "text-foreground font-semibold bg-muted/50";

import { ThemeToggle } from "./ThemeToggle";

// ... imports remain the same

export default function MobileNav() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    setMounted(true);
  }, []);

  const overlay = (
    <div
      className={cn(
        "fixed inset-0 z-[9999] transition",
        open ? "pointer-events-auto" : "pointer-events-none"
      )}
      aria-hidden={!open}
    >
      <div
        className={cn(
          "absolute inset-0 bg-black/40 transition-opacity",
          open ? "opacity-100" : "opacity-0"
        )}
        onClick={() => setOpen(false)}
      />
      <aside
        id="mobile-nav"
        role="dialog"
        aria-modal="true"
        className={cn(
          "absolute left-0 top-0 h-full w-72 bg-background border-r border-border shadow-lg transition-transform flex flex-col",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-16 items-center justify-between border-b border-border px-4 shrink-0">
          <span className="text-base font-semibold text-foreground">Menu</span>
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Close navigation menu"
            onClick={() => setOpen(false)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <nav className="flex flex-col gap-1 p-4 flex-1 overflow-y-auto">
          <Link
            href="/"
            aria-current={pathname === "/" ? "page" : undefined}
            className={cn(baseClassName, pathname === "/" && activeClassName)}
            onClick={() => setOpen(false)}
          >
            <span>Home</span>
          </Link>
          {NAV_ITEMS.map((item) => {
            const active = isNavItemActive(pathname, item);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(baseClassName, active && activeClassName)}
                onClick={() => setOpen(false)}
              >
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-border shrink-0">
          <div className="flex items-center justify-between">
            <span className="text-base font-medium text-muted-foreground">Theme</span>
            <ThemeToggle />
          </div>
        </div>
      </aside>
    </div>
  );

  return (
    <div className="lg:hidden">
      <button
        type="button"
        className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:text-foreground"
        aria-label="Open navigation menu"
        aria-expanded={open}
        aria-controls="mobile-nav"
        onClick={() => setOpen(true)}
      >
        <Menu className="h-5 w-5" />
      </button>
      {mounted ? createPortal(overlay, document.body) : null}
    </div>
  );
}
