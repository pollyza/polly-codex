import { NextRequest } from "next/server";
import { jsonWithCors, optionsWithCors } from "@/lib/api";
import { createDeviceUser, getCurrentUserFromRequest, getDeviceIdFromRequest } from "@/lib/auth";
import { createSource } from "@/lib/store";

export async function POST(request: NextRequest) {
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

  if (body.raw_text.trim().length < 180) {
    return jsonWithCors(
      {
        error: {
          code: "SOURCE_TOO_SHORT",
          message: "The captured page does not contain enough body text."
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
