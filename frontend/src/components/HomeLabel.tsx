'use client';

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export default function HomeLabel() {
    const pathname = usePathname();
    const isActive = pathname === "/";

    return (
        <span className={cn(
            "hidden lg:inline-block text-sm transition-colors group-hover:text-foreground",
            isActive ? "text-foreground font-bold" : "text-muted-foreground font-medium"
        )}>
            Home
        </span>
    );
}
