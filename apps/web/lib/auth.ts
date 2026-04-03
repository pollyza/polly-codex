import { createHmac } from "node:crypto";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { hasSupabaseAuthConfig } from "@/lib/supabase-shared";
import { getSupabaseRouteHandlerClient, getSupabaseServerComponentClient } from "@/lib/supabase-server";

export const SESSION_COOKIE_NAME = "polly_session";
export const DEVICE_HEADER_NAME = "x-polly-device-id";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
};

type SignedPayload = {
  sub: string;
  email: string;
  name: string;
  kind: "web" | "extension";
  exp: number;
};

function base64UrlEncode(value: string) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function getAuthSecret() {
  return process.env.AUTH_SECRET || "polly-dev-secret";
}

function userIdFromEmail(email: string) {
  const hex = createHmac("sha256", getAuthSecret()).update(email.toLowerCase()).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function signPayload(payload: SignedPayload) {
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const signature = createHmac("sha256", getAuthSecret()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifyToken(token: string): SignedPayload | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) {
    return null;
  }

  const expectedSignature = createHmac("sha256", getAuthSecret()).update(encoded).digest("base64url");
  if (signature !== expectedSignature) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encoded)) as SignedPayload;
    if (!payload.exp || payload.exp * 1000 < Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function createAuthUser(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const name = normalizedEmail.split("@")[0] || "Polly user";

  return {
    id: userIdFromEmail(normalizedEmail),
    email: normalizedEmail,
    name
  } satisfies AuthUser;
}

export function createDeviceUser(deviceId: string) {
  const normalized = deviceId.trim().toLowerCase();
  return createAuthUser(`device+${normalized}@polly.local`);
}

export function createWebSessionToken(user: AuthUser) {
  return signPayload({
    sub: user.id,
    email: user.email,
    name: user.name,
    kind: "web",
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7
  });
}

export function createExtensionToken(user: AuthUser) {
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 3;
  return {
    token: signPayload({
      sub: user.id,
      email: user.email,
      name: user.name,
      kind: "extension",
      exp: expiresAt
    }),
    expiresAt
  };
}

function mapPayloadToUser(payload: SignedPayload): AuthUser {
  return {
    id: payload.sub,
    email: payload.email,
    name: payload.name
  };
}

export async function getCurrentUserFromCookies() {
  if (hasSupabaseAuthConfig()) {
    const supabase = await getSupabaseServerComponentClient();
    if (supabase) {
      const {
        data: { user }
      } = await supabase.auth.getUser();
      if (user?.email) {
        return {
          id: user.id,
          email: user.email,
          name: user.user_metadata?.name || user.email.split("@")[0] || "Polly user"
        };
      }
    }
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }

  const payload = verifyToken(token);
  return payload ? mapPayloadToUser(payload) : null;
}

export async function getCurrentUserFromRequest(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (bearerToken) {
    const payload = verifyToken(bearerToken);
    return payload ? mapPayloadToUser(payload) : null;
  }

  if (hasSupabaseAuthConfig()) {
    const supabase = getSupabaseRouteHandlerClient(request);
    if (supabase) {
      const {
        data: { user }
      } = await supabase.auth.getUser();
      if (user?.email) {
        return {
          id: user.id,
          email: user.email,
          name: user.user_metadata?.name || user.email.split("@")[0] || "Polly user"
        };
      }
    }
  }

  const cookieToken = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
  if (!cookieToken) {
    return null;
  }

  const payload = verifyToken(cookieToken);
  return payload ? mapPayloadToUser(payload) : null;
}

export function getDeviceIdFromRequest(request: NextRequest) {
  return request.headers.get(DEVICE_HEADER_NAME)?.trim() || null;
}
