import { createServerClient } from "@supabase/ssr"
import { type NextRequest, NextResponse } from "next/server"

import { getSupabaseAnonKey, getSupabaseServerUrl } from "@/lib/env"
import { AUTH_COOKIE_OPTIONS } from "@/lib/supabase/cookie"

const publicRoutes = [
  "/landing",
  "/login",
  "/signup",
  "/recover-password",
  "/reset-password",
]

const authOnlyRedirects = ["/login", "/signup", "/recover-password"]

export async function middleware(request: NextRequest) {
  // Canonical @supabase/ssr middleware pattern: refresh the auth session and
  // forward any rotated cookies on both pass-through and redirect responses.
  let supabaseResponse = NextResponse.next({ request })

  // Server-side code may need a different Supabase URL than the browser
  // (e.g. a containerized frontend reaching a host-local stack through
  // host.docker.internal) — SUPABASE_URL overrides when set.
  const supabase = createServerClient(
    getSupabaseServerUrl(),
    getSupabaseAnonKey(),
    {
      cookieOptions: AUTH_COOKIE_OPTIONS,
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value)
          }
          supabaseResponse = NextResponse.next({ request })
          for (const { name, value, options } of cookiesToSet) {
            supabaseResponse.cookies.set(name, value, options)
          }
        },
      },
    },
  )

  // IMPORTANT: getUser() revalidates the JWT against Supabase Auth — do not
  // replace it with getSession(), which trusts the cookie unverified.
  const {
    data: { user },
    error: getUserError,
  } = await supabase.auth.getUser()
  if (getUserError && getUserError.name !== "AuthSessionMissingError") {
    // Surfaces topology problems (e.g. the container cannot reach the
    // Supabase stack) in the server logs instead of a silent login loop.
    console.error("middleware getUser failed:", getUserError.message)
  }

  const { pathname } = request.nextUrl
  const isPublic = publicRoutes.some((route) => pathname.startsWith(route))

  const redirectWithCookies = (path: string) => {
    const url = request.nextUrl.clone()
    url.pathname = path
    const redirect = NextResponse.redirect(url)
    for (const cookie of supabaseResponse.cookies.getAll()) {
      redirect.cookies.set(cookie)
    }
    return redirect
  }

  if (!user && !isPublic) {
    return redirectWithCookies(pathname === "/" ? "/landing" : "/login")
  }

  if (user && authOnlyRedirects.some((r) => pathname.startsWith(r))) {
    return redirectWithCookies("/")
  }

  return supabaseResponse
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|assets|favicon.ico).*)"],
}
