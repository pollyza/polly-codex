import { createHash } from "node:crypto";
import type { OutputLanguage, SourceType } from "@/lib/types";

export function detectLanguage(text: string): OutputLanguage {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  return chineseChars > Math.max(20, text.length * 0.08) ? "zh" : "en";
}

export function buildContentHash(rawText: string) {
  return createHash("sha256").update(rawText).digest("hex");
}

export function deriveDomain(sourceUrl: string) {
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

export function deriveSourceType(sourceUrl: string): SourceType {
  return /feishu|larksuite/.test(sourceUrl) ? "feishu_doc" : "webpage";
}

export function cleanText(rawText: string) {
  const bannedPatterns = [
    /^(home|首页|menu|导航)$/i,
    /^(log in|sign in|登录|注册)$/i,
    /^(share|分享|copy link|复制链接)$/i,
    /^(back|返回|next|上一页|下一页)$/i,
    /^(privacy policy|terms|cookies|隐私政策|服务条款)$/i
  ];

  const lines = rawText
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line.length > 1)
    .filter((line) => !bannedPatterns.some((pattern) => pattern.test(line)))
    .filter((line, index, all) => line.length > 18 || all[index - 1]?.length > 18 || all[index + 1]?.length > 18);

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const key = line.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(line);
  }

  return deduped.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function buildHostScript(title: string, cleanedText: string, language: OutputLanguage) {
  const shortBody = cleanedText.slice(0, 560);
  if (language === "zh") {
    return `今天这期我们不逐字朗读这篇内容，而是把它压缩成一段更适合听的讲解。先说结论，这篇页面最值得关注的是它在 ${title} 里真正想表达的重点。接下来我会先讲核心判断，再补充背景、关键动作和对业务的影响。原始内容里最值得带走的信息包括：${shortBody}`;
  }

  return `Today we are not reading the page word for word. We are turning it into a host-style briefing. The main takeaway from ${title} is the signal behind the page, not just the surface copy. From here, the script walks through the key message, the supporting evidence, and what this means for a product or operations team. The source material starts from: ${shortBody}`;
}

export function buildSummary(title: string, language: OutputLanguage) {
  return language === "zh"
    ? `这期内容围绕《${title}》展开，先讲结论，再拆关键点和业务影响。`
    : `This episode reframes "${title}" into a short spoken briefing with takeaways and implications.`;
}

export function estimateAudioDurationSeconds(targetMinutes: 3 | 5 | 8) {
  return targetMinutes * 60 - 13;
}
