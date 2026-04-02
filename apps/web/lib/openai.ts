import type { OutputLanguage } from "@/lib/types";

type GeneratedPodcastAssets = {
  title: string;
  summary: string;
  outline: string[];
  scriptText: string;
  llmProvider: string;
  llmModel: string;
  promptVersion: string;
};

function getOpenAIKey() {
  return process.env.OPENAI_API_KEY;
}

function parseJsonBlock<T>(text: string): T {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("Model did not return valid JSON.");
    }
    return JSON.parse(match[0]) as T;
  }
}

export function hasOpenAIConfig() {
  return Boolean(getOpenAIKey());
}

export async function generatePodcastAssets(input: {
  sourceTitle: string;
  cleanedText: string;
  outputLanguage: OutputLanguage;
  targetDurationMinutes: 3 | 5 | 8;
}): Promise<GeneratedPodcastAssets> {
  const apiKey = getOpenAIKey();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const model = process.env.OPENAI_TEXT_MODEL || "gpt-4o-mini";
  const targetWordHint =
    input.outputLanguage === "zh"
      ? input.targetDurationMinutes * 240
      : input.targetDurationMinutes * 145;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "You turn dense page content into a host-style podcast script for busy product managers and operations teams. Return valid JSON only."
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Create a host-style spoken briefing in ${input.outputLanguage === "zh" ? "Chinese" : "English"}.

Requirements:
- Start with the main takeaway
- Explain the page instead of reading it literally
- Keep the tone concise, professional, and easy to follow by ear
- Aim for about ${targetWordHint} ${input.outputLanguage === "zh" ? "Chinese characters" : "English words"}
- Preserve important facts and names
- No bullet points inside the script

Return JSON with this exact shape:
{
  "title": "episode title",
  "summary": "2-4 sentence summary",
  "outline": ["section 1", "section 2", "section 3"],
  "scriptText": "full script"
}

Source title:
${input.sourceTitle}

Source content:
${input.cleanedText.slice(0, 12000)}`
            }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI text generation failed with ${response.status}.`);
  }

  const data = await response.json();
  const outputText = data.output_text || "";
  const parsed = parseJsonBlock<{
    title: string;
    summary: string;
    outline: string[];
    scriptText: string;
  }>(outputText);

  return {
    title: parsed.title,
    summary: parsed.summary,
    outline: parsed.outline,
    scriptText: parsed.scriptText,
    llmProvider: "openai",
    llmModel: model,
    promptVersion: "script_host_v2"
  };
}

export async function synthesizeSpeech(input: {
  text: string;
  outputLanguage: OutputLanguage;
}) {
  const apiKey = getOpenAIKey();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const model = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
  const voice =
    input.outputLanguage === "zh"
      ? process.env.OPENAI_TTS_VOICE_ZH || "sage"
      : process.env.OPENAI_TTS_VOICE_EN || "alloy";

  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      voice,
      format: "mp3",
      instructions: "Speak like a concise podcast host with calm pacing and crisp delivery.",
      input: input.text.slice(0, 4096)
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI speech generation failed with ${response.status}.`);
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());

  return {
    buffer: audioBuffer,
    contentType: "audio/mpeg",
    model,
    voice
  };
}
