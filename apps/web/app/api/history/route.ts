import { NextRequest } from "next/server";
import { jsonWithCors, optionsWithCors } from "@/lib/api";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { listJobSummaries } from "@/lib/store";

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

  const jobs = await listJobSummaries(user.id);

  return jsonWithCors({
    items: jobs.map((job) => ({
      id: job.id,
      title: job.title,
      status: job.status,
      output_language: job.outputLanguage,
      target_duration_minutes: job.targetDurationMinutes,
      source_type: job.sourceType,
      domain: job.domain,
      audio_duration_seconds: job.audioDurationSeconds ?? null,
      created_at: job.createdAt
    })),
    next_cursor: null
  });
}

export const OPTIONS = optionsWithCors;
