import crypto from "crypto";
import { cookies } from "next/headers";

const SESSION_SECRET = process.env.SESSION_SECRET || "topten_dev_session_secret_change_me";
const COOKIE = "topten_session";

export function signUserId(userId: string): string {
  const mac = crypto.createHmac("sha256", SESSION_SECRET).update(userId).digest("hex").slice(0, 32);
  return `${userId}.${mac}`;
}

export function verifySignedUserId(token: string | undefined | null): string | null {
  if (typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const userId = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(userId).digest("hex").slice(0, 32);
  if (mac.length !== expected.length) return null;
  try {
    return crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected)) ? userId : null;
  } catch {
    return null;
  }
}

export async function getOrCreateUserId(): Promise<{ userId: string; freshToken: string | null }> {
  const jar = await cookies();
  const existing = jar.get(COOKIE)?.value;
  const verified = verifySignedUserId(existing);
  if (verified) return { userId: verified, freshToken: null };
  const userId = crypto.randomUUID();
  return { userId, freshToken: signUserId(userId) };
}

export function sessionCookieName() {
  return COOKIE;
}
