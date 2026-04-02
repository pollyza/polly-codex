import { randomUUID } from "node:crypto";
import { buildContentHash, buildHostScript, buildSummary, cleanText, detectLanguage, deriveDomain, deriveSourceType, estimateAudioDurationSeconds } from "@/lib/content";
import { generatePodcastAssets, hasOpenAIConfig, synthesizeSpeech } from "@/lib/openai";
import { seededAudios, seededJobs, seededScripts, seededSources, seededUsage, DEMO_USER_ID } from "@/lib/seed-data";
import { getSupabaseServerClient } from "@/lib/supabase-shared";
import type { AudioRecord, JobDetail, JobRecord, OutputLanguage, ScriptRecord, SourceRecord, SourceType, UsageSummary } from "@/lib/types";

const memory = {
  sources: [...seededSources],
  jobs: [...seededJobs],
  scripts: [...seededScripts],
  audios: [...seededAudios],
  usage: { ...seededUsage }
};
const runningJobs = new Set<string>();

function nowIso() {
  return new Date().toISOString();
}

function normalizeDuration(value: number): 3 | 5 | 8 {
  return value === 3 || value === 5 || value === 8 ? value : 5;
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

    if (buffer && bucket) {
      const { error: uploadError } = await supabase.storage.from(bucket).upload(storagePath, buffer, {
        contentType: "audio/mpeg",
        upsert: true
      });
      if (!uploadError) {
        publicUrl = supabase.storage.from(bucket).getPublicUrl(storagePath).data.publicUrl;
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
    return;
  }

  memory.audios.unshift(audio);
}

async function consumeUsage(userId: string, jobId: string, minutes: number) {
  const supabase = getSupabaseServerClient();
  if (supabase) {
    const { error } = await supabase.from("usage_ledger").insert({
      user_id: userId,
      job_id: jobId,
      entry_type: "consume_generation",
      minutes_delta: -minutes,
      note: "Generated audio briefing",
      period_key: seededUsage.periodKey
    });
    if (error) {
      throw error;
    }
    return;
  }

  memory.usage.minutesUsed += minutes;
  memory.usage.minutesRemaining = Math.max(0, memory.usage.freeMinutesTotal - memory.usage.minutesUsed);
}

async function runJob(jobId: string, userId = DEMO_USER_ID) {
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

    await setJobStatus(jobId, "extracting");

    let script: ScriptRecord;
    let audio: AudioRecord;

    if (hasOpenAIConfig()) {
      await setJobStatus(jobId, "writing");
      const generated = await generatePodcastAssets({
        sourceTitle: detail.source.title,
        cleanedText: sourceText,
        outputLanguage: detail.job.outputLanguage,
        targetDurationMinutes: detail.job.targetDurationMinutes
      });

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
        outputLanguage: detail.job.outputLanguage
      });
      const dataUrl = `data:${speech.contentType};base64,${speech.buffer.toString("base64")}`;
      audio = {
        id: randomUUID(),
        jobId,
        storagePath: `audio/${jobId}.mp3`,
        publicUrl: dataUrl,
        format: "mp3",
        durationSeconds: estimateAudioDurationSeconds(detail.job.targetDurationMinutes),
        sizeBytes: speech.buffer.byteLength,
        ttsProvider: "openai",
        ttsVoiceId: speech.voice,
        createdAt: nowIso()
      };
      await saveAudio(audio, speech.buffer);
      await consumeUsage(userId, jobId, detail.job.targetDurationMinutes);
      await setJobStatus(jobId, "succeeded", {
        title: generated.title,
        summary: generated.summary,
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
    await setJobStatus(jobId, "failed", {
      errorCode: "GENERATION_FAILED",
      errorMessage: error instanceof Error ? error.message : "Unknown generation failure",
      finishedAt: nowIso()
    });
  } finally {
    runningJobs.delete(jobId);
  }
}

function triggerJob(jobId: string, userId = DEMO_USER_ID) {
  void runJob(jobId, userId);
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
};

export async function listJobs(userId = DEMO_USER_ID) {
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
  const supabase = getSupabaseServerClient();
  if (supabase) {
    const periodKey = seededUsage.periodKey;
    const { data, error } = await supabase
      .from("usage_ledger")
      .select("minutes_delta")
      .eq("user_id", userId)
      .eq("period_key", periodKey);
    if (error) {
      throw error;
    }
    const balance = (data ?? []).reduce((sum, row) => sum + Number(row.minutes_delta), 0);
    return {
      periodKey,
      freeMinutesTotal: 60,
      minutesUsed: Math.max(0, 60 - balance),
      minutesRemaining: Math.max(0, balance)
    };
  }

  return usageFromMemory();
}

export async function getJobDetail(jobId: string, userId = DEMO_USER_ID): Promise<JobDetail | null> {
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
    const detail = {
      job: mapJobFromSupabase(row),
      source: mapSourceFromSupabase(row.sources),
      script: row.scripts?.[0] ? mapScriptFromSupabase(row.scripts[0]) : null,
      audio: row.audios?.[0] ? mapAudioFromSupabase(row.audios[0]) : null
    };
    if (detail.job.status !== "succeeded" && detail.job.status !== "failed") {
      triggerJob(detail.job.id, userId);
    }
    return detail;
  }

  const job = memory.jobs.find((item) => item.id === jobId && item.userId === userId);
  if (!job) {
    return null;
  }
  const evolved = hasOpenAIConfig() ? job : evolveJob(job);
  const source = memory.sources.find((item) => item.id === evolved.sourceId);
  if (!source) {
    return null;
  }
  if (evolved.status !== "succeeded" && evolved.status !== "failed") {
    triggerJob(evolved.id, userId);
  }
  return {
    job: evolved,
    source,
    script: memory.scripts.find((item) => item.jobId === evolved.id) ?? null,
    audio: memory.audios.find((item) => item.jobId === evolved.id) ?? null
  };
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

  const targetDurationMinutes = normalizeDuration(input.targetDurationMinutes);
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
    const { error } = await supabase.from("jobs").insert({
      id: job.id,
      user_id: job.userId,
      source_id: job.sourceId,
      status: job.status,
      output_language: job.outputLanguage,
      target_duration_minutes: job.targetDurationMinutes,
      script_style: job.scriptStyle,
      title: job.title,
      summary: job.summary,
      created_at: job.createdAt,
      updated_at: job.updatedAt,
      started_at: job.startedAt
    });
    if (error) {
      throw error;
    }
    triggerJob(job.id, userId);
    return job;
  }

  memory.jobs.unshift(job);
  triggerJob(job.id, userId);
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
    targetDurationMinutes: detail.job.targetDurationMinutes
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
    format: "mp3",
    durationSeconds: Number(row.duration_seconds ?? 0),
    sizeBytes: Number(row.size_bytes ?? 0),
    ttsProvider: String(row.tts_provider ?? "unknown"),
    ttsVoiceId: String(row.tts_voice_id ?? ""),
    createdAt: String(row.created_at)
  };
}
