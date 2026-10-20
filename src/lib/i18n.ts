/** Helpers shared by server and client components. */
export const LOCALE_COOKIE = "NEXT_LOCALE";
export const LOCALE_PATTERN = /^[a-z]{2}(-[A-Z]{2})?$/;

/** Prefix an internal path with the locale; leave external/anchor/mail links alone. */
export function localizeHref(href: string | null | undefined, locale: string): string {
  if (!href) return `/${locale}`;
  if (/^(https?:|mailto:|tel:|#)/i.test(href)) return href;
  if (!href.startsWith("/")) return href;
  const first = href.split(/[/?#]/)[1] ?? "";
  if (LOCALE_PATTERN.test(first)) return href;
  return href === "/" ? `/${locale}` : `/${locale}${href}`;
}

export function isExternal(href: string) {
  return /^https?:/i.test(href);
}

/** Swap the locale segment of a pathname. */
export function switchLocalePath(pathname: string, to: string) {
  const parts = pathname.split("/");
  if (parts[1] && LOCALE_PATTERN.test(parts[1])) parts[1] = to;
  else parts.splice(1, 0, to);
  return parts.join("/") || `/${to}`;
}

export function makeT(strings: Record<string, string>) {
  return (key: string, fallback?: string) => strings[key] ?? fallback ?? key;
}
