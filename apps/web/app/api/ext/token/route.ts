import { NextRequest } from "next/server";
import { createExtensionToken, getCurrentUserFromRequest } from "@/lib/auth";
import { jsonWithCors, optionsWithCors } from "@/lib/api";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) {
    return jsonWithCors(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "You need to log in before connecting the extension."
        }
      },
      { status: 401 }
    );
  }

  const state = request.nextUrl.searchParams.get("state") || "";
  const { token, expiresAt } = createExtensionToken(user);

  return jsonWithCors({
    state,
    access_token: token,
    expires_at: expiresAt,
    user
  });
}

export const OPTIONS = optionsWithCors;
