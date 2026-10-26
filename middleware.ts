import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const NO_STORE = "no-store, no-cache, must-revalidate, private";

export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/api/dashboard") ||
    pathname === "/sign-document" ||
    pathname.startsWith("/signing-frame") ||
    pathname.startsWith("/shm-docs") ||
    pathname === "/login" ||
    pathname === "/register"
  ) {
    response.headers.set("Cache-Control", NO_STORE);
    response.headers.set("Pragma", "no-cache");
    response.headers.set("Expires", "0");
  }

  return response;
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/api/dashboard/:path*",
    "/sign-document",
    "/signing-frame",
    "/shm-docs/:path*",
    "/login",
    "/register",
  ],
};
