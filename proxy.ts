// Lekcja 7: proxy.ts (w Next.js 16 dawne middleware.ts) – odświeża sesję Supabase przy każdym zapytaniu.
import type { NextRequest } from "next/server";
import { updateSession } from "./lib/supabase-auth/proxy";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // Bez plików statycznych i obrazów.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
