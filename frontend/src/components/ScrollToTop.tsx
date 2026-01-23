'use client';

import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";

export function ScrollToTop() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setIsVisible(window.scrollY > 300);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <button
      type="button"
      aria-label="Back to top"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className={[
        "fixed bottom-4 right-4 z-50",
        "rounded-full border border-border shadow-lg",
        "bg-background/80 text-foreground backdrop-blur",
        "transition-all duration-300 ease-out",
        "hover:bg-muted",
        "h-11 w-11 sm:h-12 sm:w-12",
        isVisible
          ? "opacity-100 translate-y-0 scale-100"
          : "opacity-0 translate-y-3 scale-95 pointer-events-none",
      ].join(" ")}
    >
      <ArrowUp className="h-5 w-5 sm:h-6 sm:w-6 mx-auto" />
    </button>
  );
}
