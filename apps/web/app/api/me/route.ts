import { NextRequest } from "next/server";
import { jsonWithCors, optionsWithCors } from "@/lib/api";
import { createDeviceUser, getCurrentUserFromRequest, getDeviceIdFromRequest } from "@/lib/auth";
import { getUsageSummary } from "@/lib/store";

export async function GET(request: NextRequest) {
  const user = (await getCurrentUserFromRequest(request)) || (getDeviceIdFromRequest(request) ? createDeviceUser(getDeviceIdFromRequest(request)!) : null);
  if (!user) {
    return jsonWithCors(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "Device id is required."
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
      name: user.name
    },
    usage: {
      period_key: usage.periodKey,
      free_trial_runs_total: usage.freeTrialRunsTotal,
      trial_runs_used: usage.trialRunsUsed,
      trial_runs_remaining: usage.trialRunsRemaining
    }
  });
}

export const OPTIONS = optionsWithCors;
