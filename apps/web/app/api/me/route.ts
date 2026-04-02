import { NextRequest } from "next/server";
import { jsonWithCors, optionsWithCors } from "@/lib/api";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { getUsageSummary } from "@/lib/store";

export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) {
    return jsonWithCors(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication required."
        }
      },
      { status: 401 }
    );
  }

  const usage = await getUsageSummary(user.id);

  return jsonWithCors({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      default_output_language: "zh",
      default_duration_minutes: 5
    },
    usage: {
      period_key: usage.periodKey,
      free_minutes_total: usage.freeMinutesTotal,
      minutes_used: usage.minutesUsed,
      minutes_remaining: usage.minutesRemaining
    }
  });
}

export const OPTIONS = optionsWithCors;
