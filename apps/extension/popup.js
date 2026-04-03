const statusEl = document.getElementById("status");
const generateButton = document.getElementById("generateButton");
const providerSelect = document.getElementById("provider");
const languageSelect = document.getElementById("language");
const durationSelect = document.getElementById("duration");
const apiKeyInput = document.getElementById("apiKey");
const accountEmailEl = document.getElementById("accountEmail");
const minutesRemainingEl = document.getElementById("minutesRemaining");
const DEFAULT_APP_URL = "https://web-pollyzas-projects.vercel.app";
const APP_URL_KEY = "pollyAppUrl";
const DEVICE_ID_KEY = "pollyDeviceId";
const USER_KEY_STORAGE = "pollyUserKey";
const TRIAL_COUNT_KEY = "pollyTrialRunsUsed";
const FREE_TRIAL_RUNS = 3;

async function getStorage(keys) {
  return chrome.storage.local.get(keys);
}

async function setStorage(value) {
  return chrome.storage.local.set(value);
}

async function getAppUrl() {
  const result = await getStorage([APP_URL_KEY]);
  return result[APP_URL_KEY] || DEFAULT_APP_URL;
}

async function getDeviceId() {
  const result = await getStorage([DEVICE_ID_KEY]);
  if (result[DEVICE_ID_KEY]) {
    return result[DEVICE_ID_KEY];
  }
  const id = crypto.randomUUID();
  await setStorage({ [DEVICE_ID_KEY]: id });
  return id;
}

async function getTrialRunsUsed() {
  const result = await getStorage([TRIAL_COUNT_KEY]);
  return Number(result[TRIAL_COUNT_KEY] || 0);
}

async function setTrialRunsUsed(value) {
  await setStorage({ [TRIAL_COUNT_KEY]: value });
}

async function getStoredUserKey() {
  const result = await getStorage([USER_KEY_STORAGE]);
  return result[USER_KEY_STORAGE] || { provider: "gemini", apiKey: "" };
}

async function persistUserKey() {
  const provider = providerSelect.value || "gemini";
  const apiKey = apiKeyInput.value.trim();
  await setStorage({
    [USER_KEY_STORAGE]: {
      provider,
      apiKey
    }
  });
}

async function refreshPopupState() {
  const trialRunsUsed = await getTrialRunsUsed();
  const trialRunsRemaining = Math.max(0, FREE_TRIAL_RUNS - trialRunsUsed);
  const storedKey = await getStoredUserKey();
  const appUrl = await getAppUrl();

  providerSelect.value = storedKey.provider || "gemini";
  apiKeyInput.value = storedKey.apiKey || "";
  accountEmailEl.textContent = storedKey.apiKey ? `BYO ${providerSelect.value}` : "Trial";
  minutesRemainingEl.textContent = String(trialRunsRemaining);
  statusEl.textContent = storedKey.apiKey
    ? `Using your ${providerSelect.value} API key. Target: ${appUrl}`
    : `You have ${trialRunsRemaining} free trial run${trialRunsRemaining === 1 ? "" : "s"} left.`;
}

providerSelect?.addEventListener("change", () => {
  void persistUserKey();
  void refreshPopupState();
});

apiKeyInput?.addEventListener("change", () => {
  void persistUserKey();
  void refreshPopupState();
});

void refreshPopupState();

generateButton?.addEventListener("click", async () => {
  const deviceId = await getDeviceId();
  const appUrl = await getAppUrl();
  const trialRunsUsed = await getTrialRunsUsed();
  const trialRunsRemaining = Math.max(0, FREE_TRIAL_RUNS - trialRunsUsed);
  const provider = providerSelect.value || "gemini";
  const apiKey = apiKeyInput.value.trim();
  await setStorage({
    [USER_KEY_STORAGE]: {
      provider,
      apiKey
    }
  });
  const usingOwnKey = Boolean(apiKey);

  if (!usingOwnKey && trialRunsRemaining <= 0) {
    statusEl.textContent = "Your 3 free runs are used up. Paste your OpenAI or Gemini API key to continue.";
    return;
  }

  statusEl.textContent = "Capturing current page...";

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    statusEl.textContent = "No active tab found.";
    return;
  }

  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const BLOCK_SELECTOR = [
        "article",
        "main",
        "[role='main']",
        ".article",
        ".article-content",
        ".doc-content",
        ".op-guide-content",
        ".ql-editor",
        ".ne-doc-main",
        ".wiki-content",
        ".lark-editor"
      ].join(",");

      function normalizeText(text) {
        return text
          .replace(/\u00a0/g, " ")
          .replace(/\n{3,}/g, "\n\n")
          .replace(/[ \t]+\n/g, "\n")
          .trim();
      }

      function linkDensity(element) {
        const text = normalizeText(element.innerText || "");
        const linkText = Array.from(element.querySelectorAll("a"))
          .map((anchor) => anchor.innerText || "")
          .join(" ");
        return text.length === 0 ? 0 : linkText.length / text.length;
      }

      function scoreCandidate(element) {
        const text = normalizeText(element.innerText || "");
        const paragraphs = element.querySelectorAll("p").length;
        const headings = element.querySelectorAll("h1,h2,h3").length;
        const lists = element.querySelectorAll("li").length;
        const buttons = element.querySelectorAll("button").length;
        const densityPenalty = linkDensity(element) * 1800;
        return text.length + paragraphs * 180 + headings * 120 + lists * 40 - buttons * 120 - densityPenalty;
      }

      function getCandidateBlocks() {
        const preferred = Array.from(document.querySelectorAll(BLOCK_SELECTOR));
        const generic = Array.from(document.querySelectorAll("section, div"));
        return [...preferred, ...generic].filter((element) => normalizeText(element.innerText || "").length > 200);
      }

      const candidates = getCandidateBlocks();
      const best = candidates.sort((left, right) => scoreCandidate(right) - scoreCandidate(left))[0] || document.body;
      const extractedText = normalizeText(best?.innerText || document.body?.innerText || "").slice(0, 20000);
      const extractedHtml = (best?.outerHTML || document.body?.outerHTML || "").slice(0, 50000);

      return {
        title: document.title,
        url: window.location.href,
        text: extractedText,
        rawHtml: extractedHtml,
        pageLanguageHint: document.documentElement?.lang || null,
        extractionStrategy: best === document.body ? "body_fallback" : "scored_main_candidate",
        charCount: extractedText.length
      };
    }
  });

  const commonHeaders = {
    "Content-Type": "application/json",
    "x-polly-device-id": deviceId
  };

  const payload = {
    source_type: (result.result.url || "").includes("feishu") ? "feishu_doc" : "webpage",
    source_url: result.result.url,
    title: result.result.title,
    raw_html: result.result.rawHtml,
    raw_text: result.result.text,
    extraction_meta: {
      page_language_hint: result.result.pageLanguageHint,
      extraction_strategy: result.result.extractionStrategy,
      char_count: result.result.charCount
    }
  };

  try {
    statusEl.textContent = "Submitting page content...";

    const sourceResponse = await fetch(`${appUrl}/api/sources`, {
      method: "POST",
      headers: commonHeaders,
      body: JSON.stringify(payload)
    });
    const sourceData = await sourceResponse.json();

    if (!sourceResponse.ok) {
      if (sourceData?.error?.code === "SOURCE_TOO_SHORT") {
        throw new Error("This page does not contain enough clean body text yet. Try a document body or article page.");
      }
      throw new Error(sourceData.error?.message || "Failed to create source.");
    }

    statusEl.textContent = "Creating audio job...";

    const jobResponse = await fetch(`${appUrl}/api/jobs`, {
      method: "POST",
      headers: commonHeaders,
      body: JSON.stringify({
        source_id: sourceData.source.id,
        output_language: languageSelect.value,
        target_duration_minutes: Number(durationSelect.value),
        auth_mode: usingOwnKey ? "byo_key" : "trial",
        provider,
        user_api_key: usingOwnKey ? apiKey : null
      })
    });
    const jobData = await jobResponse.json();

    if (!jobResponse.ok) {
      if (jobData?.error?.code === "INSUFFICIENT_QUOTA") {
        await setTrialRunsUsed(FREE_TRIAL_RUNS);
        throw new Error("Your 3 free runs are used up. Add your own OpenAI or Gemini API key to continue.");
      }
      throw new Error(jobData.error?.message || "Failed to create job.");
    }

    if (!usingOwnKey) {
      await setTrialRunsUsed(trialRunsUsed + 1);
    }
    void refreshPopupState();

    statusEl.textContent = "Opening job page...";
    await chrome.tabs.create({
      url: `${appUrl}/jobs/${jobData.job.id}?device_id=${encodeURIComponent(deviceId)}`
    });
  } catch (error) {
    statusEl.textContent = error instanceof Error ? error.message : "Something went wrong.";
  }
});
