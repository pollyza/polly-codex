import { createCipheriv, createDecipheriv, createHash, randomUUID } from "node:crypto";
import { buildContentHash, buildHostScript, buildSummary, cleanText, detectLanguage, deriveDomain, deriveSourceType, estimateAudioDurationSeconds } from "@/lib/content";
import { generatePodcastAssets, hasProviderConfig, synthesizeSpeech } from "@/lib/openai";
import { seededAudios, seededJobs, seededScripts, seededSources, seededUsage, DEMO_USER_ID } from "@/lib/seed-data";
import { getSupabaseServerClient } from "@/lib/supabase-shared";
import type { AudioRecord, AuthMode, JobDetail, JobRecord, ModelProvider, OutputLanguage, ScriptRecord, SourceRecord, SourceType, UsageLedgerEntry, UsageSummary } from "@/lib/types";

const memory = {
  sources: [...seededSources],
  jobs: [...seededJobs],
  scripts: [...seededScripts],
  audios: [...seededAudios],
  usage: { ...seededUsage }
};
const runningJobs = new Set<string>();
const FREE_TRIAL_RUNS = 3;
const MAX_INLINE_AUDIO_BYTES = 4_000_000;
const jobSecrets = new Map<string, { provider: ModelProvider; apiKey?: string | null; authMode: AuthMode }>();
const JOB_META_PREFIX = "polly-meta:";

function getEncryptionKey() {
  return createHash("sha256").update(process.env.AUTH_SECRET || "polly-dev-secret").digest();
}

function encryptApiKey(apiKey: string) {
  const iv = Buffer.from(randomUUID().replace(/-/g, "").slice(0, 24), "hex");
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decryptApiKey(ciphertext?: string | null) {
  if (!ciphertext) {
    return null;
  }

  const [ivPart, tagPart, encryptedPart] = ciphertext.split(".");
  if (!ivPart || !tagPart || !encryptedPart) {
    return null;
  }

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      getEncryptionKey(),
      Buffer.from(ivPart, "base64url")
    );
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedPart, "base64url")),
      decipher.final()
    ]);
    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}

function encodeJobMeta(job: Pick<JobRecord, "provider" | "authMode" | "providerApiKeyCiphertext">) {
  const payload = JSON.stringify({
    provider: job.provider,
    authMode: job.authMode,
    providerApiKeyCiphertext: job.providerApiKeyCiphertext ?? null
  });
  return `${JOB_META_PREFIX}${Buffer.from(payload).toString("base64url")}`;
}

function decodeJobMeta(rawValue: unknown) {
  if (typeof rawValue !== "string" || !rawValue.startsWith(JOB_META_PREFIX)) {
    return null;
  }

  try {
    const decoded = JSON.parse(Buffer.from(rawValue.slice(JOB_META_PREFIX.length), "base64url").toString("utf8")) as {
      provider?: string;
      authMode?: string;
      providerApiKeyCiphertext?: string | null;
    };
    return {
      provider: normalizeProvider(decoded.provider),
      authMode: decoded.authMode === "byo_key" ? "byo_key" : "trial",
      providerApiKeyCiphertext: decoded.providerApiKeyCiphertext ?? null
    } satisfies Pick<JobRecord, "provider" | "authMode" | "providerApiKeyCiphertext">;
  } catch {
    return null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function getCurrentPeriodKey() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function normalizeDuration(value: number): 3 | 5 | 8 {
  return value === 3 || value === 5 || value === 8 ? value : 5;
}

function normalizeProvider(value: string | undefined): ModelProvider {
  return value === "gemini" ? "gemini" : "openai";
}

function isRetryableOpenAIQuotaError(error: unknown) {
  return error instanceof Error &&
    error.message.includes("OpenAI text generation failed with 429") &&
    error.message.includes("insufficient_quota");
}

function toUserFacingGenerationError(error: unknown, authMode: AuthMode, provider: ModelProvider) {
  if (error instanceof Error) {
    if (error.message.includes("OpenAI text generation failed with 429") && error.message.includes("insufficient_quota")) {
      if (authMode === "trial") {
        return "Polly's built-in OpenAI trial quota is currently exhausted. Add your own OpenAI or Gemini API key in the extension, or switch the provider to Gemini and try again.";
      }
      return `Your ${provider === "openai" ? "OpenAI" : "Gemini"} API key was rejected because the provider reported insufficient quota. Check billing or switch providers.`;
    }
    if (error.message.includes("429 rate_limited")) {
      return `The ${provider === "openai" ? "OpenAI" : "Gemini"} API is rate limiting requests right now. Wait a moment and try again.`;
    }
    return error.message;
  }

  return "Unknown generation failure";
}

function evolveJob(job: JobRecord): JobRecord {
  if (job.status === "succeeded" || job.status === "failed") {
    return job;
  }

  const elapsedMs = Date.now() - new Date(job.createdAt).getTime();
  const checkpoints: Array<{ ms: number; status: JobRecord["status"] }> = [
    { ms: 2_000, status: "extracting" },
    { ms: 5_000, status: "writing" },
    { ms: 9_000, status: "synthesizing" },
    { ms: 14_000, status: "succeeded" }
  ];

  let next: JobRecord["status"] = job.status;
  for (const checkpoint of checkpoints) {
    if (elapsedMs >= checkpoint.ms) {
      next = checkpoint.status;
    }
  }

  if (next === job.status) {
    return job;
  }

  const updatedJob: JobRecord = {
    ...job,
    status: next,
    updatedAt: nowIso(),
    finishedAt: next === "succeeded" ? nowIso() : null
  };

  const index = memory.jobs.findIndex((item) => item.id === job.id);
  if (index >= 0) {
    memory.jobs[index] = updatedJob;
  }

  if (next === "succeeded" && !memory.scripts.find((item) => item.jobId === job.id)) {
    const source = memory.sources.find((item) => item.id === job.sourceId);
    if (source) {
      const scriptText = buildHostScript(source.title, source.cleanedText ?? source.rawText, job.outputLanguage);
      const script: ScriptRecord = {
        id: randomUUID(),
        jobId: job.id,
        outputLanguage: job.outputLanguage,
        outlineJson: {
          sections: job.outputLanguage === "zh"
            ? ["结论", "关键点", "业务影响"]
            : ["Takeaway", "Key points", "Implications"]
        },
        scriptText,
        wordCount: scriptText.length,
        llmProvider: "mock-openai",
        llmModel: "gpt-4.1-mini",
        promptVersion: "script_host_v1",
        createdAt: nowIso()
      };
      const audio: AudioRecord = {
        id: randomUUID(),
        jobId: job.id,
        storagePath: `audio/${job.id}.mp3`,
        publicUrl: createSilentWavDataUrl(),
        format: "mp3",
        durationSeconds: estimateAudioDurationSeconds(job.targetDurationMinutes),
        sizeBytes: 1_100_000,
        ttsProvider: "mock-tts",
        ttsVoiceId: job.outputLanguage === "zh" ? "host_cn_01" : "host_en_01",
        createdAt: nowIso()
      };
      memory.scripts.unshift(script);
      memory.audios.unshift(audio);
    }
  }

  return updatedJob;
}

async function setJobStatus(jobId: string, status: JobRecord["status"], fields?: Partial<JobRecord>) {
  const supabase = getSupabaseServerClient();
  const updatedAt = nowIso();

  if (supabase) {
    const payload: Record<string, unknown> = {
      status,
      updated_at: updatedAt
    };

    if (fields?.startedAt !== undefined) {
      payload.started_at = fields.startedAt;
    }
    if (fields?.finishedAt !== undefined) {
      payload.finished_at = fields.finishedAt;
    }
    if (fields?.errorCode !== undefined) {
      payload.error_code = fields.errorCode;
    }
    if (fields?.errorMessage !== undefined) {
      payload.error_message = fields.errorMessage;
    }
    if (fields?.title !== undefined) {
      payload.title = fields.title;
    }
    if (fields?.summary !== undefined) {
      payload.summary = fields.summary;
    }

    const { error } = await supabase.from("jobs").update(payload).eq("id", jobId);
    if (error) {
      throw error;
    }
    return;
  }

  const index = memory.jobs.findIndex((item) => item.id === jobId);
  if (index >= 0) {
    memory.jobs[index] = {
      ...memory.jobs[index],
      ...fields,
      status,
      updatedAt
    };
  }
}

async function saveScript(script: ScriptRecord) {
  const supabase = getSupabaseServerClient();
  if (supabase) {
    const { error } = await supabase.from("scripts").insert({
      id: script.id,
      job_id: script.jobId,
      output_language: script.outputLanguage,
      outline_json: script.outlineJson,
      script_text: script.scriptText,
      word_count: script.wordCount,
      llm_provider: script.llmProvider,
      llm_model: script.llmModel,
      prompt_version: script.promptVersion,
      created_at: script.createdAt
    });
    if (error) {
      throw error;
    }
    return;
  }

  memory.scripts.unshift(script);
}

async function saveAudio(audio: AudioRecord, buffer?: Buffer) {
  const supabase = getSupabaseServerClient();
  if (supabase) {
    const bucket = process.env.SUPABASE_AUDIO_BUCKET;
    let publicUrl = audio.publicUrl;
    let storagePath = audio.storagePath;
    let uploadErrorMessage: string | null = null;

    if (buffer && bucket) {
      const { error: uploadError } = await supabase.storage.from(bucket).upload(storagePath, buffer, {
        contentType: "audio/mpeg",
        upsert: true
      });
      if (!uploadError) {
        publicUrl = supabase.storage.from(bucket).getPublicUrl(storagePath).data.publicUrl;
      } else {
        uploadErrorMessage = uploadError.message;
      }
    }

    const { error } = await supabase.from("audios").insert({
      id: audio.id,
      job_id: audio.jobId,
      storage_path: storagePath,
      public_url: publicUrl,
      format: audio.format,
      duration_seconds: audio.durationSeconds,
      size_bytes: audio.sizeBytes,
      tts_provider: audio.ttsProvider,
      tts_voice_id: audio.ttsVoiceId,
      created_at: audio.createdAt
    });
    if (error) {
      throw error;
    }
    return {
      publicUrl,
      uploadErrorMessage
    };
  }

  memory.audios.unshift(audio);
  return {
    publicUrl: audio.publicUrl,
    uploadErrorMessage: null
  };
}

async function consumeUsage(userId: string, jobId: string, minutes: number) {
  void minutes;
  const supabase = getSupabaseServerClient();
  if (supabase) {
    return;
  }

  memory.usage.trialRunsUsed += 1;
  memory.usage.trialRunsRemaining = Math.max(0, FREE_TRIAL_RUNS - memory.usage.trialRunsUsed);
}

async function ensureMonthlyGrant(userId: string) {
  void userId;
  memory.usage.periodKey = getCurrentPeriodKey();
  memory.usage.freeTrialRunsTotal = FREE_TRIAL_RUNS;
  memory.usage.trialRunsRemaining = Math.max(0, memory.usage.freeTrialRunsTotal - memory.usage.trialRunsUsed);
}

export async function listUsageLedger(userId = DEMO_USER_ID): Promise<UsageLedgerEntry[]> {
  const periodKey = getCurrentPeriodKey();

  await ensureMonthlyGrant(userId);
  return [
    {
      id: "usage_grant_demo",
      userId,
      jobId: null,
      entryType: "grant_monthly_free",
      minutesDelta: FREE_TRIAL_RUNS,
      note: "Starter trial runs",
      periodKey,
      createdAt: new Date(`${periodKey}-01T00:00:00Z`).toISOString()
    },
    ...memory.jobs
      .filter((job) => job.userId === userId && job.status === "succeeded")
      .map((job) => ({
        id: `usage_${job.id}`,
        userId,
        jobId: job.id,
        entryType: "consume_generation" as const,
        minutesDelta: -1,
        note: `${job.provider} ${job.authMode === "trial" ? "trial" : "BYO key"} generation`,
        periodKey,
        createdAt: job.finishedAt ?? job.updatedAt
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  ];
}

async function getMinutesRemaining(userId: string) {
  const usage = await getUsageSummary(userId);
  return usage.trialRunsRemaining;
}

async function runJob(
  jobId: string,
  userId = DEMO_USER_ID,
  generationOptions?: { provider?: ModelProvider; apiKey?: string | null; authMode?: AuthMode }
) {
  if (runningJobs.has(jobId)) {
    return;
  }
  runningJobs.add(jobId);

  try {
    const detail = await getJobDetail(jobId, userId);
    if (!detail || detail.job.status === "succeeded" || detail.job.status === "failed") {
      return;
    }

    const sourceText = detail.source.cleanedText ?? detail.source.rawText;
    const secrets = generationOptions ?? jobSecrets.get(jobId) ?? {
      provider: detail.job.provider,
      apiKey: decryptApiKey(detail.job.providerApiKeyCiphertext),
      authMode: detail.job.authMode
    };
    const provider = normalizeProvider(secrets.provider);
    const authMode = secrets.authMode ?? detail.job.authMode;

    await setJobStatus(jobId, "extracting");

    let script: ScriptRecord;
    let audio: AudioRecord;

    if (hasProviderConfig(provider, secrets.apiKey)) {
      await setJobStatus(jobId, "writing");
      let effectiveProvider = provider;
      let generated;

      try {
        generated = await generatePodcastAssets({
          sourceTitle: detail.source.title,
          cleanedText: sourceText,
          sourceType: detail.source.sourceType,
          outputLanguage: detail.job.outputLanguage,
          targetDurationMinutes: detail.job.targetDurationMinutes,
          provider: effectiveProvider,
          apiKeyOverride: secrets.apiKey
        });
      } catch (error) {
        const canFallbackToGemini =
          authMode === "trial" &&
          effectiveProvider === "openai" &&
          !secrets.apiKey &&
          hasProviderConfig("gemini") &&
          isRetryableOpenAIQuotaError(error);

        if (!canFallbackToGemini) {
          throw error;
        }

        effectiveProvider = "gemini";
        generated = await generatePodcastAssets({
          sourceTitle: detail.source.title,
          cleanedText: sourceText,
          sourceType: detail.source.sourceType,
          outputLanguage: detail.job.outputLanguage,
          targetDurationMinutes: detail.job.targetDurationMinutes,
          provider: effectiveProvider,
          apiKeyOverride: null
        });
      }

      script = {
        id: randomUUID(),
        jobId,
        outputLanguage: detail.job.outputLanguage,
        outlineJson: {
          sections: generated.outline
        },
        scriptText: generated.scriptText,
        wordCount: generated.scriptText.length,
        llmProvider: generated.llmProvider,
        llmModel: generated.llmModel,
        promptVersion: generated.promptVersion,
        createdAt: nowIso()
      };

      await saveScript(script);

      await setJobStatus(jobId, "synthesizing", {
        title: generated.title,
        summary: generated.summary
      });

      const speech = await synthesizeSpeech({
        text: generated.scriptText,
        turns: generated.turns,
        outputLanguage: detail.job.outputLanguage,
        provider: effectiveProvider,
        apiKeyOverride: effectiveProvider === provider ? secrets.apiKey : null
      });
      if (speech.buffer.byteLength > MAX_INLINE_AUDIO_BYTES && !process.env.SUPABASE_AUDIO_BUCKET) {
        throw new Error("Generated audio is too large for inline fallback. Configure Supabase Storage.");
      }
      const dataUrl = `data:${speech.contentType};base64,${speech.buffer.toString("base64")}`;
      audio = {
        id: randomUUID(),
        jobId,
        storagePath: `audio/${jobId}.mp3`,
        publicUrl: dataUrl,
        format: speech.contentType === "audio/wav" ? "wav" : "mp3",
        durationSeconds: estimateAudioDurationSeconds(detail.job.targetDurationMinutes),
        sizeBytes: speech.buffer.byteLength,
        ttsProvider: effectiveProvider,
        ttsVoiceId: speech.voice,
        createdAt: nowIso()
      };
      const audioResult = await saveAudio(audio, speech.buffer);
      if (authMode === "trial") {
        await consumeUsage(userId, jobId, detail.job.targetDurationMinutes);
      }
      await setJobStatus(jobId, "succeeded", {
        title: generated.title,
        summary: generated.summary,
        errorCode: audioResult.uploadErrorMessage
          ? "STORAGE_FALLBACK"
          : effectiveProvider !== provider
            ? "TRIAL_PROVIDER_FALLBACK"
            : null,
        errorMessage: audioResult.uploadErrorMessage
          ? `Audio uploaded with data URL fallback because storage upload failed: ${audioResult.uploadErrorMessage}`
          : effectiveProvider !== provider
            ? "Polly trial OpenAI quota was exhausted, so this run automatically fell back to Gemini."
          : null,
        finishedAt: nowIso()
      });
      return;
    }

    await setJobStatus(jobId, "writing");
    const scriptText = buildHostScript(detail.source.title, sourceText, detail.job.outputLanguage);
    script = {
      id: randomUUID(),
      jobId,
      outputLanguage: detail.job.outputLanguage,
      outlineJson: {
        sections: detail.job.outputLanguage === "zh"
          ? ["结论", "关键点", "业务影响"]
          : ["Takeaway", "Key points", "Implications"]
      },
      scriptText,
      wordCount: scriptText.length,
      llmProvider: "mock-openai",
      llmModel: "gpt-4o-mini",
      promptVersion: "script_host_v1",
      createdAt: nowIso()
    };
    await saveScript(script);
    await setJobStatus(jobId, "synthesizing");

    audio = {
      id: randomUUID(),
      jobId,
      storagePath: `audio/${jobId}.mp3`,
      publicUrl: createSilentWavDataUrl(),
      format: "mp3",
      durationSeconds: estimateAudioDurationSeconds(detail.job.targetDurationMinutes),
      sizeBytes: 1_100_000,
      ttsProvider: "mock-tts",
      ttsVoiceId: detail.job.outputLanguage === "zh" ? "host_cn_01" : "host_en_01",
      createdAt: nowIso()
    };
    await saveAudio(audio);
    await consumeUsage(userId, jobId, detail.job.targetDurationMinutes);
    await setJobStatus(jobId, "succeeded", {
      finishedAt: nowIso()
    });
  } catch (error) {
    const fallbackProvider = normalizeProvider(generationOptions?.provider);
    const fallbackAuthMode = generationOptions?.authMode ?? "trial";
    await setJobStatus(jobId, "failed", {
      errorCode: "GENERATION_FAILED",
      errorMessage: toUserFacingGenerationError(error, fallbackAuthMode, fallbackProvider),
      finishedAt: nowIso()
    });
  } finally {
    runningJobs.delete(jobId);
    jobSecrets.delete(jobId);
  }
}

function triggerJob(
  jobId: string,
  userId = DEMO_USER_ID,
  generationOptions?: { provider?: ModelProvider; apiKey?: string | null; authMode?: AuthMode }
) {
  if (generationOptions) {
    jobSecrets.set(jobId, {
      provider: normalizeProvider(generationOptions.provider),
      apiKey: generationOptions.apiKey,
      authMode: generationOptions.authMode ?? "trial"
    });
  }
  void runJob(jobId, userId, generationOptions);
}

function usageFromMemory(): UsageSummary {
  return {
    ...memory.usage
  };
}

function createSilentWavDataUrl() {
  const sampleRate = 8000;
  const durationSeconds = 1;
  const numSamples = sampleRate * durationSeconds;
  const dataSize = numSamples;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate, 28);
  buffer.writeUInt16LE(1, 32);
  buffer.writeUInt16LE(8, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  buffer.fill(128, 44);

  return `data:audio/wav;base64,${buffer.toString("base64")}`;
}

async function ensureSupabaseUser(userId: string) {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return;
  }

  await supabase.from("users").upsert({
    id: userId,
    email: `${userId}@polly.local`,
    name: "Polly device",
    created_at: nowIso(),
    updated_at: nowIso()
  });
}

type CreateSourceInput = {
  sourceType?: SourceType;
  sourceUrl: string;
  title?: string;
  rawHtml?: string;
  rawText: string;
  extractionMeta?: Record<string, unknown>;
};

type CreateJobInput = {
  sourceId: string;
  outputLanguage: OutputLanguage;
  targetDurationMinutes: number;
  authMode?: AuthMode;
  provider?: ModelProvider;
  apiKey?: string | null;
};

export async function listJobs(userId = DEMO_USER_ID) {
  userId = userId || DEMO_USER_ID;
  const supabase = getSupabaseServerClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("jobs")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) {
      throw error;
    }
    const jobs = (data ?? []).map(mapJobFromSupabase);
    jobs
      .filter((job) => job.status !== "succeeded" && job.status !== "failed")
      .forEach((job) => triggerJob(job.id, userId));
    return jobs;
  }

  return memory.jobs
    .filter((job) => job.userId === userId)
    .map((job) => evolveJob(job))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listJobSummaries(userId = DEMO_USER_ID) {
  userId = userId || DEMO_USER_ID;
  const jobs = await listJobs(userId);
  const details = await Promise.all(jobs.map((job) => getJobDetail(job.id, userId)));

  return jobs.map((job, index) => {
    const detail = details[index];
    return {
      ...job,
      sourceType: detail?.source.sourceType ?? "webpage",
      domain: detail?.source.domain ?? "unknown",
      audioDurationSeconds: detail?.audio?.durationSeconds ?? null
    };
  });
}

export async function getUsageSummary(userId = DEMO_USER_ID) {
  userId = userId || DEMO_USER_ID;
  await ensureMonthlyGrant(userId);
  return usageFromMemory();
}

export async function getJobDetail(jobId: string, userId = DEMO_USER_ID): Promise<JobDetail | null> {
  userId = userId || DEMO_USER_ID;
  const supabase = getSupabaseServerClient();
  if (supabase) {
    const { data: jobs, error } = await supabase
      .from("jobs")
      .select(`
        *,
        sources (*),
        scripts (*),
        audios (*)
      `)
      .eq("id", jobId)
      .eq("user_id", userId)
      .limit(1);
    if (error) {
      throw error;
    }
    const row = jobs?.[0];
    if (!row) {
      return null;
    }
    const sourceRow = Array.isArray(row.sources) ? row.sources[0] : row.sources;
    const scriptRow = Array.isArray(row.scripts) ? row.scripts[0] : row.scripts;
    const audioRow = Array.isArray(row.audios) ? row.audios[0] : row.audios;
    if (!sourceRow) {
      return null;
    }
    const detail = {
      job: mapJobFromSupabase(row),
      source: mapSourceFromSupabase(sourceRow),
      script: scriptRow ? mapScriptFromSupabase(scriptRow) : null,
      audio: audioRow ? mapAudioFromSupabase(audioRow) : null
    };
    return detail;
  }

  const job = memory.jobs.find((item) => item.id === jobId && item.userId === userId);
  if (!job) {
    return null;
  }
  const evolved = job;
  const source = memory.sources.find((item) => item.id === evolved.sourceId);
  if (!source) {
    return null;
  }
  return {
    job: evolved,
    source,
    script: memory.scripts.find((item) => item.jobId === evolved.id) ?? null,
    audio: memory.audios.find((item) => item.jobId === evolved.id) ?? null
  };
}

export async function processJobNow(jobId: string, userId = DEMO_USER_ID) {
  userId = userId || DEMO_USER_ID;
  await runJob(jobId, userId);
  return getJobDetail(jobId, userId);
}

export async function createSource(input: CreateSourceInput, userId = DEMO_USER_ID) {
  const cleanedText = cleanText(input.rawText);
  const sourceType = input.sourceType ?? deriveSourceType(input.sourceUrl);
  const title = input.title?.trim() || "Untitled page";
  const source: SourceRecord = {
    id: randomUUID(),
    userId,
    sourceType,
    sourceUrl: input.sourceUrl,
    domain: deriveDomain(input.sourceUrl),
    title,
    detectedLanguage: detectLanguage(cleanedText),
    rawHtml: input.rawHtml ?? null,
    rawText: input.rawText,
    cleanedText,
    contentHash: buildContentHash(cleanedText),
    extractionMeta: input.extractionMeta ?? {},
    createdAt: nowIso()
  };

  const supabase = getSupabaseServerClient();
  if (supabase) {
    await ensureSupabaseUser(userId);
    const { error } = await supabase.from("sources").insert({
      id: source.id,
      user_id: source.userId,
      source_type: source.sourceType,
      source_url: source.sourceUrl,
      domain: source.domain,
      title: source.title,
      detected_language: source.detectedLanguage,
      raw_html: source.rawHtml,
      raw_text: source.rawText,
      cleaned_text: source.cleanedText,
      content_hash: source.contentHash,
      extraction_meta: source.extractionMeta,
      created_at: source.createdAt
    });
    if (error) {
      throw error;
    }
    return source;
  }

  memory.sources.unshift(source);
  return source;
}

export async function createJob(input: CreateJobInput, userId = DEMO_USER_ID) {
  const targetDurationMinutes = normalizeDuration(input.targetDurationMinutes);
  const authMode = input.authMode ?? "trial";
  const provider = normalizeProvider(input.provider);

  const supabase = getSupabaseServerClient();
  let source =
    memory.sources.find((item) => item.id === input.sourceId) ??
    seededSources.find((item) => item.id === input.sourceId);

  if (!source && supabase) {
    const { data, error } = await supabase
      .from("sources")
      .select("*")
      .eq("id", input.sourceId)
      .eq("user_id", userId)
      .limit(1);
    if (error) {
      throw error;
    }
    source = data?.[0] ? mapSourceFromSupabase(data[0]) : undefined;
  }

  const title = source
    ? input.outputLanguage === "zh"
      ? `用 ${targetDurationMinutes} 分钟听懂这份 ${source.title}`
      : `${targetDurationMinutes}-minute host briefing on ${source.title}`
    : "New audio briefing";
  const summary = source ? buildSummary(source.title, input.outputLanguage) : "A newly created audio briefing job.";

  const job: JobRecord = {
    id: randomUUID(),
    userId,
    sourceId: input.sourceId,
    authMode,
    provider,
    providerApiKeyCiphertext: input.apiKey ? encryptApiKey(input.apiKey) : null,
    status: "queued",
    outputLanguage: input.outputLanguage,
    targetDurationMinutes,
    scriptStyle: "host_explainer",
    title,
    summary,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    startedAt: nowIso(),
    finishedAt: null,
    errorCode: null,
    errorMessage: null
  };

  if (supabase) {
    await ensureSupabaseUser(userId);
    const baseInsert = {
      id: job.id,
      user_id: job.userId,
      source_id: job.sourceId,
      voice_id: encodeJobMeta(job),
      status: job.status,
      output_language: job.outputLanguage,
      target_duration_minutes: job.targetDurationMinutes,
      script_style: job.scriptStyle,
      title: job.title,
      summary: job.summary,
      created_at: job.createdAt,
      updated_at: job.updatedAt,
      started_at: job.startedAt
    };
    const { error } = await supabase.from("jobs").insert({
      ...baseInsert,
      auth_mode: job.authMode,
      provider: job.provider,
      provider_api_key_ciphertext: job.providerApiKeyCiphertext
    });
    if (error) {
      const message = "message" in error ? String(error.message) : "";
      if (
        message.includes("auth_mode") ||
        message.includes("provider") ||
        message.includes("provider_api_key_ciphertext")
      ) {
        const fallback = await supabase.from("jobs").insert(baseInsert);
        if (fallback.error) {
          throw fallback.error;
        }
      } else {
        throw error;
      }
    }
    triggerJob(job.id, userId, {
      provider,
      apiKey: input.apiKey,
      authMode
    });
    return job;
  }

  memory.jobs.unshift(job);
  triggerJob(job.id, userId, {
    provider,
    apiKey: input.apiKey,
    authMode
  });
  return job;
}

export async function retryJob(jobId: string, userId = DEMO_USER_ID) {
  const detail = await getJobDetail(jobId, userId);
  if (!detail) {
    return null;
  }

  return createJob({
    sourceId: detail.source.id,
    outputLanguage: detail.job.outputLanguage,
    targetDurationMinutes: detail.job.targetDurationMinutes,
    authMode: detail.job.authMode,
    provider: detail.job.provider,
    apiKey: decryptApiKey(detail.job.providerApiKeyCiphertext)
  }, userId);
}

function mapSourceFromSupabase(row: Record<string, unknown>): SourceRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    sourceType: row.source_type as SourceType,
    sourceUrl: String(row.source_url),
    domain: String(row.domain ?? "unknown"),
    title: String(row.title ?? "Untitled page"),
    detectedLanguage: (row.detected_language as OutputLanguage) ?? "en",
    rawHtml: (row.raw_html as string | null) ?? null,
    rawText: String(row.raw_text ?? ""),
    cleanedText: (row.cleaned_text as string | null) ?? null,
    contentHash: String(row.content_hash ?? ""),
    extractionMeta: (row.extraction_meta as Record<string, unknown>) ?? {},
    createdAt: String(row.created_at)
  };
}

function mapJobFromSupabase(row: Record<string, unknown>): JobRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    sourceId: String(row.source_id),
    authMode: (row.auth_mode as AuthMode) ?? decodeJobMeta(row.voice_id)?.authMode ?? "trial",
    provider: normalizeProvider((row.provider as string | undefined) ?? decodeJobMeta(row.voice_id)?.provider),
    providerApiKeyCiphertext: (row.provider_api_key_ciphertext as string | null) ?? decodeJobMeta(row.voice_id)?.providerApiKeyCiphertext ?? null,
    status: row.status as JobRecord["status"],
    outputLanguage: row.output_language as OutputLanguage,
    targetDurationMinutes: Number(row.target_duration_minutes) as 3 | 5 | 8,
    scriptStyle: "host_explainer",
    title: String(row.title ?? "Audio briefing"),
    summary: String(row.summary ?? ""),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    startedAt: (row.started_at as string | null) ?? null,
    finishedAt: (row.finished_at as string | null) ?? null,
    errorCode: (row.error_code as string | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null
  };
}

function mapScriptFromSupabase(row: Record<string, unknown>): ScriptRecord {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    outputLanguage: row.output_language as OutputLanguage,
    outlineJson: (row.outline_json as ScriptRecord["outlineJson"]) ?? { sections: [] },
    scriptText: String(row.script_text ?? ""),
    wordCount: Number(row.word_count ?? 0),
    llmProvider: String(row.llm_provider ?? "openai"),
    llmModel: String(row.llm_model ?? "unknown"),
    promptVersion: String(row.prompt_version ?? "script_host_v1"),
    createdAt: String(row.created_at)
  };
}

function mapAudioFromSupabase(row: Record<string, unknown>): AudioRecord {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    storagePath: String(row.storage_path ?? ""),
    publicUrl: String(row.public_url ?? ""),
    format: String(row.format ?? "mp3"),
    durationSeconds: Number(row.duration_seconds ?? 0),
    sizeBytes: Number(row.size_bytes ?? 0),
    ttsProvider: String(row.tts_provider ?? "unknown"),
    ttsVoiceId: String(row.tts_voice_id ?? ""),
    createdAt: String(row.created_at)
  };
}
