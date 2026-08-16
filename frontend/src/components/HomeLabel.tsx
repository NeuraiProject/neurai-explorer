'use client';

import config from "@/config.json";

/** Brand text next to the logo: small eyebrow over the site title, as in
 *  the other Neurai apps. The whole block links to the home page. */
export default function HomeLabel() {
    return (
        <span className="flex flex-col leading-tight">
            <span className="eyebrow group-hover:text-primary transition-colors">Explorer</span>
            <span className="text-base font-bold text-foreground">{config.site.coinName}</span>
        </span>
    );
}
