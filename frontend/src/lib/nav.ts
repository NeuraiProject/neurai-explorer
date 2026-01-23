export type NavItem = {
  href: string;
  label: string;
  matchers?: string[];
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/blocks", label: "Blocks", matchers: ["/blocks", "/block"] },
  { href: "/txs", label: "Transactions", matchers: ["/txs", "/tx"] },
  { href: "/richlist", label: "Rich List" },
  { href: "/assets", label: "Assets", matchers: ["/assets", "/asset"] },
  { href: "/peers", label: "Peers" },
  { href: "/stats", label: "Statistics" },
  { href: "/api", label: "API" },
];

export function isNavItemActive(pathname: string, item: NavItem) {
  const matchers = item.matchers ?? [item.href];
  return matchers.some((matcher) => pathname === matcher || pathname.startsWith(`${matcher}/`));
}
