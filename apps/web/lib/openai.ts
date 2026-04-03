import type { ModelProvider, OutputLanguage } from "@/lib/types";

type GeneratedPodcastAssets = {
  title: string;
  summary: string;
  outline: string[];
  scriptText: string;
  llmProvider: string;
  llmModel: string;
  promptVersion: string;
};

function getServerOpenAIKey() {
  return process.env.OPENAI_API_KEY;
}

function getGeminiKey() {
  return process.env.GEMINI_API_KEY;
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

export function hasProviderConfig(provider: ModelProvider, overrideApiKey?: string | null) {
  if (overrideApiKey) {
    return true;
  }
  return provider === "openai" ? Boolean(getServerOpenAIKey()) : Boolean(getGeminiKey());
}

export async function generatePodcastAssets(input: {
  sourceTitle: string;
  cleanedText: string;
  outputLanguage: OutputLanguage;
  targetDurationMinutes: 3 | 5 | 8;
  provider: ModelProvider;
  apiKeyOverride?: string | null;
}): Promise<GeneratedPodcastAssets> {
  const targetWordHint =
    input.outputLanguage === "zh"
      ? input.targetDurationMinutes * 240
      : input.targetDurationMinutes * 145;

  if (input.provider === "gemini") {
    const apiKey = input.apiKeyOverride || getGeminiKey();
    if (!apiKey) {
      throw new Error("Gemini API key is not configured.");
    }

    const model = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash";
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
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
          ],
          generationConfig: {
            responseMimeType: "application/json"
          }
        })
      }
    );

    if (!response.ok) {
      throw new Error(`Gemini text generation failed with ${response.status}.`);
    }

    const data = await response.json();
    const outputText =
      data.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || "").join("") || "";
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
      llmProvider: "gemini",
      llmModel: model,
      promptVersion: "script_host_v3_gemini"
    };
  }

  const apiKey = input.apiKeyOverride || getServerOpenAIKey();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const model = process.env.OPENAI_TEXT_MODEL || "gpt-4o-mini";

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
  provider: ModelProvider;
  apiKeyOverride?: string | null;
}) {
  if (input.provider === "gemini") {
    const apiKey = input.apiKeyOverride || getGeminiKey();
    if (!apiKey) {
      throw new Error("Gemini API key is not configured.");
    }

    const model = process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts";
    const voice = input.outputLanguage === "zh"
      ? process.env.GEMINI_TTS_VOICE_ZH || "Kore"
      : process.env.GEMINI_TTS_VOICE_EN || "Puck";

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: input.text.slice(0, 4096)
                }
              ]
            }
          ],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: voice
                }
              }
            }
          }
        })
      }
    );

    if (!response.ok) {
      throw new Error(`Gemini speech generation failed with ${response.status}.`);
    }

    const data = await response.json();
    const inlineData = data.candidates?.[0]?.content?.parts?.find((part: { inlineData?: { data?: string; mimeType?: string } }) => part.inlineData)?.inlineData;
    if (!inlineData?.data) {
      throw new Error("Gemini speech generation did not return audio data.");
    }

    const pcmBuffer = Buffer.from(inlineData.data, "base64");
    const wavBuffer = pcmToWav(pcmBuffer, 24000);

    return {
      buffer: wavBuffer,
      contentType: "audio/wav",
      model,
      voice
    };
  }

  const apiKey = input.apiKeyOverride || getServerOpenAIKey();
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

function pcmToWav(pcmBuffer: Buffer, sampleRate: number) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcmBuffer.length;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  pcmBuffer.copy(buffer, 44);
  return buffer;
}
