import type { AudioRecord, JobRecord, ScriptRecord, SourceRecord, UsageSummary } from "@/lib/types";

export const DEMO_USER_ID = "user_demo_01";

export const seededUsage: UsageSummary = {
  periodKey: "2026-04",
  freeTrialRunsTotal: 3,
  trialRunsUsed: 1,
  trialRunsRemaining: 2
};

export const seededSources: SourceRecord[] = [
  {
    id: "source_demo_q2_growth",
    userId: DEMO_USER_ID,
    sourceType: "feishu_doc",
    sourceUrl: "https://feishu.cn/docx/demo-q2-growth",
    domain: "feishu.cn",
    title: "Q2 增长复盘",
    detectedLanguage: "zh",
    rawHtml: null,
    rawText: "Mock Feishu source content for the Q2 growth recap.",
    cleanedText: "Mock Feishu source content for the Q2 growth recap.",
    contentHash: "hash_demo_q2_growth",
    extractionMeta: {
      page_language_hint: "zh"
    },
    createdAt: "2026-04-02T10:00:00Z"
  },
  {
    id: "source_demo_competitor",
    userId: DEMO_USER_ID,
    sourceType: "webpage",
    sourceUrl: "https://example.com/launch",
    domain: "example.com",
    title: "Competitor launch page",
    detectedLanguage: "en",
    rawHtml: null,
    rawText: "Mock web page content for the latest competitor launch page.",
    cleanedText: "Mock web page content for the latest competitor launch page.",
    contentHash: "hash_demo_competitor",
    extractionMeta: {
      page_language_hint: "en"
    },
    createdAt: "2026-04-02T11:20:00Z"
  }
];

export const seededJobs: JobRecord[] = [
  {
    id: "job_demo_q2_growth",
    userId: DEMO_USER_ID,
    sourceId: "source_demo_q2_growth",
    authMode: "trial",
    provider: "openai",
    status: "succeeded",
    outputLanguage: "zh",
    targetDurationMinutes: 5,
    scriptStyle: "host_explainer",
    title: "用 5 分钟听懂这份 Q2 增长复盘",
    summary: "先讲复盘结论，再拆增长来源、关键动作和接下来的风险。",
    createdAt: "2026-04-02T10:01:00Z",
    updatedAt: "2026-04-02T10:03:12Z",
    startedAt: "2026-04-02T10:01:05Z",
    finishedAt: "2026-04-02T10:03:12Z"
  },
  {
    id: "job_demo_competitor",
    userId: DEMO_USER_ID,
    sourceId: "source_demo_competitor",
    authMode: "trial",
    provider: "openai",
    status: "writing",
    outputLanguage: "en",
    targetDurationMinutes: 8,
    scriptStyle: "host_explainer",
    title: "8-minute host briefing on the latest competitor launch page",
    summary:
      "A structured explainer that reframes the page into product positioning, feature bets, and launch signals.",
    createdAt: "2026-04-02T11:22:00Z",
    updatedAt: "2026-04-02T11:22:10Z",
    startedAt: "2026-04-02T11:22:05Z"
  }
];

export const seededScripts: ScriptRecord[] = [
  {
    id: "script_demo_q2_growth",
    jobId: "job_demo_q2_growth",
    outputLanguage: "zh",
    outlineJson: {
      sections: ["结论", "关键动作", "风险与启发"]
    },
    scriptText:
      "今天这期，我们先用一句话讲结论：这份 Q2 复盘最重要的信息，不是某一个渠道涨了多少，而是团队已经找到了一套更稳定的增长组合。接下来我们分三部分来听，先看结果，再拆动作，最后讲风险。",
    wordCount: 86,
    llmProvider: "openai",
    llmModel: "gpt-4.1-mini",
    promptVersion: "script_host_v1",
    createdAt: "2026-04-02T10:02:00Z"
  }
];

export const seededAudios: AudioRecord[] = [
  {
    id: "audio_demo_q2_growth",
    jobId: "job_demo_q2_growth",
    storagePath: "audio/job_demo_q2_growth.mp3",
    publicUrl: "",
    format: "mp3",
    durationSeconds: 287,
    sizeBytes: 1_200_000,
    ttsProvider: "mock-tts",
    ttsVoiceId: "host_cn_01",
    createdAt: "2026-04-02T10:03:12Z"
  }
];
