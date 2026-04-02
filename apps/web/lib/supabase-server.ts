import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase-shared";

export async function getSupabaseServerComponentClient() {
  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();

  if (!url || !anonKey) {
    return null;
  }

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookieValues) {
        try {
          cookieValues.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server components may not be allowed to set cookies.
        }
      }
    }
  });
}

export function getSupabaseRouteHandlerClient(request: Request, response?: Response) {
  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();

  if (!url || !anonKey) {
    return null;
  }

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        const cookieHeader = request.headers.get("cookie") || "";
        return cookieHeader
          .split(";")
          .map((part) => part.trim())
          .filter(Boolean)
          .map((part) => {
            const index = part.indexOf("=");
            const name = index >= 0 ? part.slice(0, index) : part;
            const value = index >= 0 ? part.slice(index + 1) : "";
            return { name, value };
          });
      },
      setAll(cookieValues) {
        if (!response || typeof (response as Response & { cookies?: unknown }).cookies !== "object") {
          return;
        }
        const cookieStore = (response as Response & {
          cookies: { set: (name: string, value: string, options?: Record<string, unknown>) => void };
        }).cookies;
        cookieValues.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
      }
    }
  });
}
