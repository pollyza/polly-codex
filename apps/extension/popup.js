const statusEl = document.getElementById("status");
const connectButton = document.getElementById("connectButton");
const generateButton = document.getElementById("generateButton");
const languageSelect = document.getElementById("language");
const durationSelect = document.getElementById("duration");
const accountEmailEl = document.getElementById("accountEmail");
const minutesRemainingEl = document.getElementById("minutesRemaining");
const APP_URL = "http://localhost:3000";
const STORAGE_KEY = "pollyAuth";

async function getStoredAuth() {
  const result = await chrome.storage.local.get([STORAGE_KEY]);
  return result[STORAGE_KEY] || null;
}

async function refreshPopupState() {
  const auth = await getStoredAuth();

  if (!auth?.accessToken) {
    accountEmailEl.textContent = "Not connected";
    minutesRemainingEl.textContent = "-";
    statusEl.textContent = "Connect your Polly account before generating audio.";
    return null;
  }

  try {
    const response = await fetch(`${APP_URL}/api/me`, {
      headers: {
        Authorization: `Bearer ${auth.accessToken}`
      }
    });

    if (!response.ok) {
      throw new Error("Session expired. Please reconnect.");
    }

    const data = await response.json();
    accountEmailEl.textContent = data.user.email;
    minutesRemainingEl.textContent = data.usage.minutes_remaining.toFixed(1);
    statusEl.textContent = "Ready to capture the current page.";
    return auth;
  } catch (error) {
    await chrome.storage.local.remove(STORAGE_KEY);
    accountEmailEl.textContent = "Not connected";
    minutesRemainingEl.textContent = "-";
    statusEl.textContent = error instanceof Error ? error.message : "Please reconnect.";
    return null;
  }
}

refreshPopupState();

connectButton?.addEventListener("click", async () => {
  const state = crypto.randomUUID();
  await chrome.storage.local.set({ pollyPendingState: state });
  statusEl.textContent = "Opening Polly connect page...";
  await chrome.tabs.create({
    url: `${APP_URL}/ext/connect?state=${encodeURIComponent(state)}`
  });
});

generateButton?.addEventListener("click", async () => {
  const auth = await refreshPopupState();
  if (!auth?.accessToken) {
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
    func: () => ({
      title: document.title,
      url: window.location.href,
      text: document.body?.innerText?.slice(0, 10000) ?? "",
      pageLanguageHint: document.documentElement?.lang || null
    })
  });

  const payload = {
    source_type: (result.result.url || "").includes("feishu")
      ? "feishu_doc"
      : "webpage",
    source_url: result.result.url,
    title: result.result.title,
    raw_text: result.result.text,
    extraction_meta: {
      page_language_hint: result.result.pageLanguageHint
    }
  };

  try {
    statusEl.textContent = "Submitting page content...";

    const sourceResponse = await fetch(`${APP_URL}/api/sources`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.accessToken}`
      },
      body: JSON.stringify(payload)
    });
    const sourceData = await sourceResponse.json();

    if (!sourceResponse.ok) {
      throw new Error(sourceData.error?.message || "Failed to create source.");
    }

    statusEl.textContent = "Creating audio job...";

    const jobResponse = await fetch(`${APP_URL}/api/jobs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.accessToken}`
      },
      body: JSON.stringify({
        source_id: sourceData.source.id,
        output_language: languageSelect.value,
        target_duration_minutes: Number(durationSelect.value)
      })
    });
    const jobData = await jobResponse.json();

    if (!jobResponse.ok) {
      if (jobData?.error?.code === "INSUFFICIENT_QUOTA") {
        minutesRemainingEl.textContent = "0.0";
        throw new Error("No free minutes left for this month. Open Billing to review usage.");
      }
      throw new Error(jobData.error?.message || "Failed to create job.");
    }

    statusEl.textContent = "Opening job page...";
    await chrome.tabs.create({
      url: `${APP_URL}/jobs/${jobData.job.id}`
    });
  } catch (error) {
    statusEl.textContent = error instanceof Error ? error.message : "Something went wrong.";
  }
});
