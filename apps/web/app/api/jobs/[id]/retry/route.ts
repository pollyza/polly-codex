import { NextRequest } from "next/server";
import { jsonWithCors, optionsWithCors } from "@/lib/api";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { retryJob } from "@/lib/store";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
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

  const { id } = await context.params;
  const job = await retryJob(id, user.id);

  if (!job) {
    return jsonWithCors(
      {
        error: {
          code: "JOB_NOT_FOUND",
          message: "Job not found"
        }
      },
      { status: 404 }
    );
  }

  return jsonWithCors({
    job: {
      id: job.id,
      status: job.status
    }
  });
}

export const OPTIONS = optionsWithCors;
