import { NextRequest } from "next/server";
import { jsonWithCors, optionsWithCors } from "@/lib/api";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { createSource } from "@/lib/store";

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

  if (!body.raw_text || typeof body.raw_text !== "string") {
    return jsonWithCors(
      {
        error: {
          code: "INVALID_INPUT",
          message: "raw_text is required"
        }
      },
      { status: 400 }
    );
  }

  const source = await createSource({
    sourceType: body.source_type,
    sourceUrl: body.source_url,
    title: body.title,
    rawHtml: body.raw_html,
    rawText: body.raw_text,
    extractionMeta: body.extraction_meta
  }, user.id);

  return jsonWithCors({
    source: {
      id: source.id,
      source_type: source.sourceType,
      title: source.title,
      detected_language: source.detectedLanguage,
      created_at: source.createdAt
    }
  });
}

export const OPTIONS = optionsWithCors;
