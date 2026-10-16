import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

const PUBLIC_PATHS = [
  "/",
  "/login",
  "/signup",
  "/db-unavailable",
  "/api/auth",
  "/api/webhooks",
];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.match(/\.(.*)$/)
  ) {
    return NextResponse.next();
  }

  const sessionCookie = getSessionCookie(request);
  const isAuthed = Boolean(sessionCookie);

  if (isPublic(pathname)) {
    if (isAuthed && (pathname === "/login" || pathname === "/signup")) {
      const authError = request.nextUrl.searchParams.get("error");
      // Cookie present but session could not load (e.g. DB down) — avoid /login ↔ /app loop.
      if (authError !== "session" && authError !== "banned") {
        return NextResponse.redirect(new URL("/app", request.url));
      }
    }
    return NextResponse.next();
  }

  if (!isAuthed) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const response = NextResponse.next();
  response.headers.set("x-pathname", pathname);
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\..*).*)"],
};
