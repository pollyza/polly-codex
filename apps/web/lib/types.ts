export type SourceType = "feishu_doc" | "webpage";
export type OutputLanguage = "zh" | "en";
export type ModelProvider = "openai" | "gemini";
export type AuthMode = "trial" | "byo_key";
export type JobStatus =
  | "queued"
  | "extracting"
  | "writing"
  | "synthesizing"
  | "succeeded"
  | "failed";

export type SourceRecord = {
  id: string;
  userId: string;
  sourceType: SourceType;
  sourceUrl: string;
  domain: string;
  title: string;
  detectedLanguage: OutputLanguage;
  rawHtml?: string | null;
  rawText: string;
  cleanedText?: string | null;
  contentHash: string;
  extractionMeta: Record<string, unknown>;
  createdAt: string;
};

export type JobRecord = {
  id: string;
  userId: string;
  sourceId: string;
  authMode: AuthMode;
  provider: ModelProvider;
  providerApiKeyCiphertext?: string | null;
  status: JobStatus;
  outputLanguage: OutputLanguage;
  targetDurationMinutes: 3 | 5 | 8;
  scriptStyle: "host_explainer";
  title: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
};

export type ScriptRecord = {
  id: string;
  jobId: string;
  outputLanguage: OutputLanguage;
  outlineJson: {
    sections: string[];
  };
  scriptText: string;
  wordCount: number;
  llmProvider: string;
  llmModel: string;
  promptVersion: string;
  createdAt: string;
};

export type AudioRecord = {
  id: string;
  jobId: string;
  storagePath: string;
  publicUrl: string;
  format: string;
  durationSeconds: number;
  sizeBytes: number;
  ttsProvider: string;
  ttsVoiceId: string;
  createdAt: string;
};

export type UsageSummary = {
  periodKey: string;
  freeTrialRunsTotal: number;
  trialRunsUsed: number;
  trialRunsRemaining: number;
};

export type UsageLedgerEntry = {
  id: string;
  userId: string;
  jobId?: string | null;
  entryType: "grant_monthly_free" | "consume_generation" | "adjustment";
  minutesDelta: number;
  note: string;
  periodKey: string;
  createdAt: string;
};

export type JobDetail = {
  job: JobRecord;
  source: SourceRecord;
  script: ScriptRecord | null;
  audio: AudioRecord | null;
};
