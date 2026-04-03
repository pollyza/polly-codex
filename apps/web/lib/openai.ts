import { buildHostScript, buildSummary } from "@/lib/content";
import type { ModelProvider, OutputLanguage, SourceType } from "@/lib/types";

type GeneratedPodcastAssets = {
  title: string;
  summary: string;
  outline: string[];
  scriptText: string;
  turns: PodcastTurn[];
  llmProvider: string;
  llmModel: string;
  promptVersion: string;
};

type PodcastTurn = {
  speaker: string;
  emotion?: string;
  text: string;
};

type PodcastPlanning = {
  ahaMoments?: string[];
  emotionalArc?: string;
  title?: string;
  summary?: string;
  outline?: string[];
};

type ProviderApiErrorPayload = {
  status: number;
  body: string;
};

const GEMINI_TEXT_MAX_CHARS = 12000;
const GEMINI_TTS_MAX_CHARS = 2600;
const GEMINI_TEXT_TIMEOUT_MS = 120_000;
const GEMINI_TTS_TIMEOUT_MS = 150_000;
const OPENAI_TIMEOUT_MS = 35_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNetworkFetchError(error: unknown) {
  return error instanceof TypeError && error.message.toLowerCase().includes("fetch failed");
}

async function fetchWithRetries(
  input: string,
  init: RequestInit,
  options: { retries?: number; retryDelayMs?: number; label: string }
) {
  const retries = options.retries ?? 2;
  const retryDelayMs = options.retryDelayMs ?? 1200;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetch(input, init);
    } catch (error) {
      lastError = error;
      if (error instanceof Error && error.name === "AbortError") {
        throw error;
      }
      if (!isNetworkFetchError(error) || attempt === retries) {
        break;
      }
      await sleep(retryDelayMs * (attempt + 1));
    }
  }

  if (isNetworkFetchError(lastError)) {
    throw new Error(`${options.label} failed because the provider network request could not be completed after retries.`);
  }
  throw lastError instanceof Error ? lastError : new Error(`${options.label} failed.`);
}

function compactSourceForModel(text: string, maxChars: number) {
  const blocks = text
    .split(/\n{2,}|\n/g)
    .map((block) => block.trim())
    .filter(Boolean)
    .filter((block) => block.length > 30);

  const scored = blocks
    .map((block, index) => ({
      block,
      score:
        Math.min(block.length, 420) +
        (/\d/.test(block) ? 35 : 0) +
        (/[:：]/.test(block) ? 15 : 0) +
        (/^-|^•|^\d+[.)]/.test(block) ? 20 : 0) +
        (index < 12 ? 20 : 0)
    }))
    .sort((a, b) => b.score - a.score);

  const selected: string[] = [];
  let used = 0;
  for (const item of scored) {
    if (used >= maxChars) {
      break;
    }
    const remaining = maxChars - used;
    const next = item.block.slice(0, remaining).trim();
    if (!next) {
      continue;
    }
    selected.push(next);
    used += next.length + 2;
  }

  const combined = selected.join("\n\n").trim();
  return combined || text.slice(0, maxChars);
}

function buildGeminiFallbackAssets(input: {
  sourceTitle: string;
  cleanedText: string;
  outputLanguage: OutputLanguage;
}) {
  const scriptText = buildHostScript(input.sourceTitle, input.cleanedText, input.outputLanguage);
  return {
    title:
      input.outputLanguage === "zh"
        ? `用几分钟听懂这份 ${input.sourceTitle}`
        : `A quick briefing on ${input.sourceTitle}`,
    summary: buildSummary(input.sourceTitle, input.outputLanguage),
    outline: input.outputLanguage === "zh" ? ["结论", "关键点", "影响"] : ["Takeaway", "Key points", "Implications"],
    scriptText,
    turns: [
      { speaker: "Alex", emotion: input.outputLanguage === "zh" ? "好奇" : "curious", text: scriptText.slice(0, Math.ceil(scriptText.length / 2)) },
      { speaker: "Sarah", emotion: input.outputLanguage === "zh" ? "自信" : "confident", text: scriptText.slice(Math.ceil(scriptText.length / 2)).trim() || scriptText }
    ],
    llmProvider: "gemini-fallback",
    llmModel: "local-heuristic",
    promptVersion: "script_host_v4_gemini_timeout_fallback"
  } satisfies GeneratedPodcastAssets;
}

function compactScriptForSpeech(text: string, maxChars: number) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }

  const sentences = normalized
    .split(/(?<=[。！？.!?])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const selected: string[] = [];
  let used = 0;
  for (const sentence of sentences) {
    const nextLength = used + sentence.length + (selected.length ? 1 : 0);
    if (nextLength > maxChars) {
      break;
    }
    selected.push(sentence);
    used = nextLength;
  }

  const compact = selected.join(" ").trim();
  if (compact.length >= Math.min(220, maxChars * 0.4)) {
    return compact;
  }

  return normalized.slice(0, maxChars).trim();
}

function expandScriptForSpeech(text: string, language: OutputLanguage, maxChars: number) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }

  const sentences = normalized
    .split(/(?<=[。！？.!?])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const selected: string[] = [];
  let used = 0;
  for (const sentence of sentences) {
    const nextLength = used + sentence.length + (selected.length ? 1 : 0);
    if (nextLength > maxChars) {
      break;
    }
    selected.push(sentence);
    used = nextLength;
  }

  const result = selected.join(" ").trim();
  if (result.length >= Math.min(maxChars * 0.75, maxChars - 120)) {
    return result;
  }

  return language === "zh"
    ? normalized.slice(0, maxChars).trim()
    : normalized.slice(0, maxChars).trimEnd();
}

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
    const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fencedMatch?.[1]) {
      return parseJsonBlock<T>(fencedMatch[1]);
    }

    const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      return JSON.parse(arrayMatch[0]) as T;
    }

    const objectMatch = trimmed.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      return JSON.parse(objectMatch[0]) as T;
    }

    throw new Error("Model did not return valid JSON.");
  }
}

function extractTagContent(text: string, tagName: string) {
  const match = text.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match?.[1]?.trim() || null;
}

function normalizePodcastTurn(turn: unknown, index: number): PodcastTurn | null {
  if (!turn || typeof turn !== "object") {
    return null;
  }

  const candidate = turn as Record<string, unknown>;
  const speakerRaw = candidate.speaker ?? candidate.host ?? candidate.role ?? (index % 2 === 0 ? "Alex" : "Sarah");
  const textRaw =
    candidate.text ??
    candidate.content ??
    candidate.line ??
    candidate.utterance ??
    candidate.message;

  if (typeof textRaw !== "string" || !textRaw.trim()) {
    return null;
  }

  return {
    speaker: typeof speakerRaw === "string" && speakerRaw.trim() ? speakerRaw.trim() : index % 2 === 0 ? "Alex" : "Sarah",
    emotion: typeof candidate.emotion === "string" ? candidate.emotion : undefined,
    text: textRaw.trim()
  };
}

function buildTurnsFromLooseText(text: string): PodcastTurn[] {
  const cleaned = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<planning>[\s\S]*?<\/planning>/gi, " ")
    .replace(/<script>|<\/script>/gi, " ")
    .trim();

  const speakerMatches = Array.from(cleaned.matchAll(/(?:^|\n)\s*(Alex|Sarah)\s*(?:\[[^\]]+\])?\s*[:：]\s*([\s\S]*?)(?=(?:\n\s*(?:Alex|Sarah)\s*(?:\[[^\]]+\])?\s*[:：])|$)/gi));
  if (speakerMatches.length > 0) {
    return speakerMatches
      .map((match) => ({
        speaker: match[1],
        text: match[2].trim()
      }))
      .filter((turn) => turn.text);
  }

  const paragraphs = cleaned
    .split(/\n{2,}|\n/g)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .filter((paragraph) => paragraph.length > 20)
    .slice(0, 8);

  return paragraphs.map((paragraph, index) => ({
    speaker: index % 2 === 0 ? "Alex" : "Sarah",
    text: paragraph
  }));
}

function parsePodcastTurns(text: string): PodcastTurn[] {
  const scriptBlock = extractTagContent(text, "script");
  const candidate = scriptBlock || text;
  try {
    const parsed = parseJsonBlock<PodcastTurn[] | { script?: PodcastTurn[]; turns?: PodcastTurn[]; dialogue?: PodcastTurn[] }>(candidate);
    const turns = Array.isArray(parsed)
      ? parsed
      : parsed.script || parsed.turns || parsed.dialogue || [];
    const normalized = Array.isArray(turns)
      ? turns.map((turn, index) => normalizePodcastTurn(turn, index)).filter(Boolean) as PodcastTurn[]
      : [];

    if (normalized.length > 0) {
      return normalized;
    }
  } catch {
    // Fall back to looser text extraction below.
  }

  const looseTurns = buildTurnsFromLooseText(candidate);
  if (looseTurns.length > 0) {
    return looseTurns;
  }

  throw new Error("Model did not return a valid podcast turn array.");
}

function parsePlanning(text: string): PodcastPlanning | null {
  const planningBlock = extractTagContent(text, "planning");
  if (!planningBlock) {
    return null;
  }

  try {
    return parseJsonBlock<PodcastPlanning>(planningBlock);
  } catch {
    return {
      ahaMoments: planningBlock
        .split(/\n|•|- /)
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 3)
    };
  }
}

function podcastTurnsToScriptText(turns: PodcastTurn[]) {
  return turns
    .map((turn) => {
      const emotion = turn.emotion?.trim() ? ` [${turn.emotion.trim()}]` : "";
      return `${turn.speaker}${emotion}: ${turn.text.trim()}`;
    })
    .join("\n\n");
}

function deriveOutlineFromTurns(turns: PodcastTurn[], language: OutputLanguage) {
  const labels = language === "zh"
    ? ["吸引人的开场", "核心拆解", "结尾与互动"]
    : ["Hook", "Core breakdown", "Closing and CTA"];
  return labels.slice(0, Math.min(labels.length, Math.max(3, turns.length >= 6 ? 3 : 2)));
}

function buildPodcastPrompt(input: {
  sourceTitle: string;
  sourceContent: string;
  sourceType: SourceType;
  outputLanguage: OutputLanguage;
  targetDurationMinutes: 3 | 5 | 8;
}) {
  const targetWordHint =
    input.outputLanguage === "zh"
      ? input.targetDurationMinutes * 240
      : input.targetDurationMinutes * 145;

  const sourceTypeGuidance = input.sourceType === "feishu_doc"
    ? "这是一份飞书文档。请优先识别文档里的结构、结论、行动项、背景和业务判断，像在帮团队快速过一遍一份内部材料。"
    : "这是一篇网页内容。请优先识别文章的叙事主线、作者观点、关键事实和为什么值得听众现在关注。";

  return `<system_instruction>
你是一个顶级的播客制作人、编剧兼对话设计大师。你的任务是将用户提供的<document>转化为一段引人入胜的、高度口语化的双人播客脚本。

<podcast_setup>
  <host name="Alex" role="主理人">
    <persona>好奇心强，代表听众提问，擅长总结和打比方，偶尔会开个得体的玩笑。</persona>
  </host>
  <host name="Sarah" role="领域专家">
    <persona>深度阅读了该文档的专家，负责解答问题并补充专业细节。语气自信、亲和，不用艰涩的学术词汇。</persona>
  </host>
</podcast_setup>

<guidelines>
  <rule id="1" name="口语化与真实感">绝对不要像在朗读课文。必须使用口语化的表达，包含自然的口癖、轻微的相互打断、以及对话中的顿悟时刻。</rule>
  <rule id="2" name="信息降维">不要机械罗列要点。把复杂概念转化为生活中的常见比喻，用讲故事而不是做报告的方式传递信息。</rule>
  <rule id="3" name="TTS 友好标记">在台词中插入声音提示标签，以指导后续的 TTS 引擎发音。可选标签包括：[笑声]、[叹气]、[停顿]、[激动]。</rule>
  <rule id="4" name="结构">必须包含：吸引人的开场 Hook -> 核心话题层层递进 -> 意犹未尽的结尾与听众互动。</rule>
  <rule id="5" name="信息完整度">不是简单摘要，要讲清背景、关键事实、为什么重要，以及对产品经理或运营的启发。</rule>
  <rule id="6" name="输出语言">整个脚本必须使用${input.outputLanguage === "zh" ? "中文" : "英文"}。</rule>
  <rule id="7" name="长度">整体内容目标大约为 ${targetWordHint}${input.outputLanguage === "zh" ? " 个中文字符" : " 个英文单词"}，确保信息完整且适合收听。</rule>
  <rule id="8" name="来源类型适配">${sourceTypeGuidance}</rule>
</guidelines>

<execution_steps>
第一步：在 <planning> 标签内输出合法 JSON 对象，包含：
{
  "ahaMoments": ["...", "...", "..."],
  "emotionalArc": "...",
  "title": "...",
  "summary": "...",
  "outline": ["...", "...", "..."]
}
第二步：在 <script> 标签内，严格输出合法的 JSON 数组。数组中的每一项必须包含 "speaker"、"emotion"、"text" 三个字段。
不要在 <script> 标签内添加任何解释、前后缀文字或 markdown 代码块，只保留 JSON。
</execution_steps>

<output_format>
请严格返回以下两段标签：
<planning>...</planning>
<script>[
  {
    "speaker": "Alex",
    "emotion": "激动",
    "text": "..."
  }
]</script>
</output_format>
</system_instruction>

<document_title>
${input.sourceTitle}
</document_title>

<document>
${input.sourceContent}
</document>`;
}

async function buildProviderErrorPayload(response: Response): Promise<ProviderApiErrorPayload> {
  const body = await response.text();
  return {
    status: response.status,
    body
  };
}

function formatProviderError(prefix: string, payload: ProviderApiErrorPayload) {
  const body = payload.body.toLowerCase();
  if (payload.status === 429) {
    if (body.includes("insufficient_quota")) {
      return `${prefix} failed with 429 insufficient_quota.`;
    }
    return `${prefix} failed with 429 rate_limited.`;
  }

  return `${prefix} failed with ${payload.status}.`;
}

function buildTimeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout)
  };
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
  sourceType: SourceType;
  outputLanguage: OutputLanguage;
  targetDurationMinutes: 3 | 5 | 8;
  provider: ModelProvider;
  apiKeyOverride?: string | null;
}): Promise<GeneratedPodcastAssets> {
  const defaultTitle =
    input.outputLanguage === "zh"
      ? `Alex 和 Sarah 聊聊：${input.sourceTitle}`
      : `Alex and Sarah unpack ${input.sourceTitle}`;

  if (input.provider === "gemini") {
    const apiKey = input.apiKeyOverride || getGeminiKey();
    if (!apiKey) {
      throw new Error("Gemini API key is not configured.");
    }

    const model = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash";
    const compactSource = compactSourceForModel(input.cleanedText, GEMINI_TEXT_MAX_CHARS);
    const prompt = buildPodcastPrompt({
      sourceTitle: input.sourceTitle,
      sourceContent: compactSource,
      sourceType: input.sourceType,
      outputLanguage: input.outputLanguage,
      targetDurationMinutes: input.targetDurationMinutes
    });
    const timeout = buildTimeoutSignal(GEMINI_TEXT_TIMEOUT_MS);
    try {
      const response = await fetchWithRetries(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          signal: timeout.signal,
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: prompt
                  }
                ]
              }
            ],
            generationConfig: {
              responseMimeType: "application/json"
            }
          })
        },
        { retries: 2, retryDelayMs: 1500, label: "Gemini text generation" }
      );

      if (!response.ok) {
        throw new Error(formatProviderError("Gemini text generation", await buildProviderErrorPayload(response)));
      }

      const data = await response.json();
      const outputText =
        data.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || "").join("") || "";
      const planning = parsePlanning(outputText);
      const turns = parsePodcastTurns(outputText);

      return {
        title: planning?.title?.trim() || defaultTitle,
        summary: planning?.summary?.trim() || buildSummary(input.sourceTitle, input.outputLanguage),
        outline: planning?.outline?.filter(Boolean) || deriveOutlineFromTurns(turns, input.outputLanguage),
        scriptText: podcastTurnsToScriptText(turns),
        turns,
        llmProvider: "gemini",
        llmModel: model,
        promptVersion: "dialogue_host_v2_gemini"
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return buildGeminiFallbackAssets(input);
      }
      throw error;
    } finally {
      timeout.clear();
    }
  }

  const apiKey = input.apiKeyOverride || getServerOpenAIKey();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const model = process.env.OPENAI_TEXT_MODEL || "gpt-4o-mini";
  const prompt = buildPodcastPrompt({
    sourceTitle: input.sourceTitle,
    sourceContent: input.cleanedText.slice(0, 12000),
    sourceType: input.sourceType,
    outputLanguage: input.outputLanguage,
    targetDurationMinutes: input.targetDurationMinutes
  });

  const timeout = buildTimeoutSignal(OPENAI_TIMEOUT_MS);
  try {
    const response = await fetchWithRetries("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      signal: timeout.signal,
      body: JSON.stringify({
        model,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text:
                  "You are a world-class podcast producer and dialogue writer. Follow the user's XML-style instruction format exactly."
              }
            ]
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: prompt
              }
            ]
          }
        ]
      })
    }, { retries: 2, retryDelayMs: 1200, label: "OpenAI text generation" });

    if (!response.ok) {
      throw new Error(formatProviderError("OpenAI text generation", await buildProviderErrorPayload(response)));
    }

    const data = await response.json();
    const outputText = data.output_text || "";
    const planning = parsePlanning(outputText);
    const turns = parsePodcastTurns(outputText);

    return {
      title: planning?.title?.trim() || defaultTitle,
      summary: planning?.summary?.trim() || buildSummary(input.sourceTitle, input.outputLanguage),
      outline: planning?.outline?.filter(Boolean) || deriveOutlineFromTurns(turns, input.outputLanguage),
      scriptText: podcastTurnsToScriptText(turns),
      turns,
      llmProvider: "openai",
      llmModel: model,
      promptVersion: "dialogue_host_v2_openai"
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("OpenAI text generation timed out after 35 seconds.");
    }
    throw error;
  } finally {
    timeout.clear();
  }
}

export async function synthesizeSpeech(input: {
  text: string;
  turns?: PodcastTurn[];
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
    const alexVoice = input.outputLanguage === "zh"
      ? process.env.GEMINI_TTS_VOICE_ALEX_ZH || "Puck"
      : process.env.GEMINI_TTS_VOICE_ALEX_EN || "Puck";
    const sarahVoice = input.outputLanguage === "zh"
      ? process.env.GEMINI_TTS_VOICE_SARAH_ZH || "Kore"
      : process.env.GEMINI_TTS_VOICE_SARAH_EN || "Kore";
    const attemptSpeech = async (text: string, timeoutMs: number, voice: string) => {
      const timeout = buildTimeoutSignal(timeoutMs);
      try {
        const response = await fetchWithRetries(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            signal: timeout.signal,
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    {
                      text
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
          },
          { retries: 2, retryDelayMs: 1500, label: "Gemini speech generation" }
        );
        if (!response.ok) {
          throw new Error(formatProviderError("Gemini speech generation", await buildProviderErrorPayload(response)));
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
      } finally {
        timeout.clear();
      }
    };

    const primaryText = expandScriptForSpeech(input.text, input.outputLanguage, GEMINI_TTS_MAX_CHARS);
    const retryText = compactScriptForSpeech(primaryText, 1200);

    const usableTurns = (input.turns ?? [])
      .map((turn) => ({
        ...turn,
        text: turn.text.trim()
      }))
      .filter((turn) => turn.text.length > 0)
      .slice(0, 12);

    if (usableTurns.length >= 2) {
      try {
        const segmentBuffers: Buffer[] = [];
        for (const [index, turn] of usableTurns.entries()) {
          const voice = /alex/i.test(turn.speaker) ? alexVoice : /sarah/i.test(turn.speaker) ? sarahVoice : index % 2 === 0 ? alexVoice : sarahVoice;
          const segmentText = expandScriptForSpeech(turn.text, input.outputLanguage, 550);
          const segment = await attemptSpeech(segmentText, 55_000, voice);
          segmentBuffers.push(segment.buffer, createSilenceWav(24000, 220));
        }

        return {
          buffer: concatWavBuffers(segmentBuffers),
          contentType: "audio/wav",
          model,
          voice: `${alexVoice}/${sarahVoice}`
        };
      } catch {
        // fall back to single-speaker synthesis below
      }
    }

    try {
      return await attemptSpeech(primaryText, GEMINI_TTS_TIMEOUT_MS, sarahVoice);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        try {
          return await attemptSpeech(retryText, 45_000, sarahVoice);
        } catch (retryError) {
          if (retryError instanceof Error && retryError.name === "AbortError") {
            throw new Error("Gemini speech generation timed out after multiple attempts over about 3 minutes.");
          }
          throw retryError;
        }
      }
      throw error;
    }
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

  const timeout = buildTimeoutSignal(OPENAI_TIMEOUT_MS);
  try {
    const response = await fetchWithRetries("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      signal: timeout.signal,
      body: JSON.stringify({
        model,
        voice,
        format: "mp3",
        instructions: "Speak like a concise podcast host with calm pacing and crisp delivery.",
        input: input.text.slice(0, 3200)
      })
    }, { retries: 2, retryDelayMs: 1200, label: "OpenAI speech generation" });

    if (!response.ok) {
      throw new Error(formatProviderError("OpenAI speech generation", await buildProviderErrorPayload(response)));
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());

    return {
      buffer: audioBuffer,
      contentType: "audio/mpeg",
      model,
      voice
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("OpenAI speech generation timed out after 35 seconds.");
    }
    throw error;
  } finally {
    timeout.clear();
  }
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

function createSilenceWav(sampleRate: number, durationMs: number) {
  const numSamples = Math.max(1, Math.floor((sampleRate * durationMs) / 1000));
  const pcmBuffer = Buffer.alloc(numSamples * 2);
  return pcmToWav(pcmBuffer, sampleRate);
}

function concatWavBuffers(buffers: Buffer[]) {
  const pcmChunks = buffers.map((buffer) => buffer.subarray(44));
  return pcmToWav(Buffer.concat(pcmChunks), 24000);
}
