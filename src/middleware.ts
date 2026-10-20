import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const LOCALE_RE = /^[a-z]{2}(-[A-Z]{2})?$/;
const PUBLIC_ADMIN_PATHS = ["/admin/login", "/admin/forgot-password", "/admin/auth/confirm", "/admin/auth/callback"];
const DEFAULT_LOCALE = "en";

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // ---- Admin: refresh the Supabase session and require sign-in -------------
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    let response = NextResponse.next({ request });
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return response; // the admin layout shows a configuration error

    const supabase = createServerClient(url, key, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });
    const { data } = await supabase.auth.getUser();
    const isPublic = PUBLIC_ADMIN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
    if (!data.user && !isPublic) {
      const login = request.nextUrl.clone();
      login.pathname = "/admin/login";
      login.search = `?next=${encodeURIComponent(pathname + search)}`;
      return NextResponse.redirect(login);
    }
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }

  // ---- Public site: make sure every page has a locale prefix -------------
  const first = pathname.split("/")[1] ?? "";
  if (!LOCALE_RE.test(first)) {
    const preferred = request.cookies.get("NEXT_LOCALE")?.value;
    const locale = preferred && LOCALE_RE.test(preferred) ? preferred : DEFAULT_LOCALE;
    const target = request.nextUrl.clone();
    target.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;
    return NextResponse.redirect(target, 307);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Everything except API routes, Next internals and static files.
    "/((?!api|_next/static|_next/image|favicon\\.ico|sitemap\\.xml|robots\\.txt|.*\\.(?:png|jpg|jpeg|webp|avif|svg|ico|txt|xml|woff2?)$).*)",
  ],
};
