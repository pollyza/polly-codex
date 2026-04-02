import { NextRequest } from "next/server";
import { jsonWithCors, optionsWithCors } from "@/lib/api";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { createJob } from "@/lib/store";

export async function POST(request: NextRequest) {
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

  const body = await request.json();

  if (!body.source_id) {
    return jsonWithCors(
      {
        error: {
          code: "INVALID_INPUT",
          message: "source_id is required"
        }
      },
      { status: 400 }
    );
  }

  let job;
  try {
    job = await createJob({
      sourceId: body.source_id,
      outputLanguage: body.output_language ?? "zh",
      targetDurationMinutes: Number(body.target_duration_minutes ?? 5)
    }, user.id);
  } catch (error) {
    if (error instanceof Error && error.message === "INSUFFICIENT_QUOTA") {
      return jsonWithCors(
        {
          error: {
            code: "INSUFFICIENT_QUOTA",
            message: "You do not have enough free minutes remaining."
          }
        },
        { status: 402 }
      );
    }
    throw error;
  }

  return jsonWithCors({
    job: {
      id: job.id,
      status: job.status,
      output_language: job.outputLanguage,
      target_duration_minutes: job.targetDurationMinutes,
      created_at: job.createdAt
    }
  });
}

export const OPTIONS = optionsWithCors;
