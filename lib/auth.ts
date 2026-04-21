import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const COOKIE_NAME = "rent_auth";

export async function isAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  return token === process.env.ADMIN_PASSWORD;
}

export function requireAuth(): NextResponse | null {
  // Use in API routes. Returns a 401 response if not authenticated, or null if OK.
  return null;
}

export async function checkAuthOrFail() {
  const ok = await isAuthenticated();
  if (!ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export { COOKIE_NAME };
