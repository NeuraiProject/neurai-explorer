import { FaDiscord, FaGlobe, FaRedditAlien, FaTelegram, FaXTwitter } from "react-icons/fa6";
import type { IconType } from "react-icons";
import config from "../config.json";

type SocialLink = {
  label: string;
  href: string;
  icon?: string;
};

const iconComponentMap: Record<string, IconType> = {
  FaGlobe,
  FaXTwitter,
  FaRedditAlien,
  FaTelegram,
  FaDiscord,
};

export default function FooterSocials() {
  const links = (config.site.socials || []).filter((link) => link.href);

  if (links.length === 0) {
    return null;
  }

  return (
    <ul className="flex items-center justify-center gap-4">
      {links.map(({ label, href, icon }) => {
        const Icon = icon ? iconComponentMap[icon] : undefined;

        if (!Icon) {
          return null;
        }

        return (
        <li key={label}>
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            aria-label={label}
            title={label}
            className="inline-flex items-center justify-center text-[1.65em] text-muted-foreground transition-colors hover:text-foreground"
          >
            <Icon />
          </a>
        </li>
        );
      })}
    </ul>
  );
}
