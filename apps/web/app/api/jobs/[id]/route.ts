import { NextRequest } from "next/server";
import { jsonWithCors, optionsWithCors } from "@/lib/api";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { getJobDetail } from "@/lib/store";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
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
  const detail = await getJobDetail(id, user.id);

  if (!detail) {
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
      id: detail.job.id,
      status: detail.job.status,
      title: detail.job.title,
      summary: detail.job.summary,
      output_language: detail.job.outputLanguage,
      target_duration_minutes: detail.job.targetDurationMinutes,
      script_style: "host_explainer",
      error_code: detail.job.errorCode ?? null,
      error_message: detail.job.errorMessage ?? null,
      created_at: detail.job.createdAt,
      finished_at: detail.job.finishedAt ?? null
    },
    source: {
      id: detail.source.id,
      title: detail.source.title,
      source_url: detail.source.sourceUrl,
      source_type: detail.source.sourceType,
      domain: detail.source.domain
    },
    script: detail.script
      ? {
          id: detail.script.id,
          script_text: detail.script.scriptText,
          outline_json: detail.script.outlineJson
        }
      : null,
    audio: detail.audio
      ? {
          id: detail.audio.id,
          public_url: detail.audio.publicUrl,
          duration_seconds: detail.audio.durationSeconds,
          format: detail.audio.format
        }
      : null
  });
}

export const OPTIONS = optionsWithCors;
