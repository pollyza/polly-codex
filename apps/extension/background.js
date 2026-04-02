const STORAGE_KEY = "pollyAuth";

chrome.runtime.onInstalled.addListener(() => {
  console.log("Polly extension installed");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "POLLY_EXTENSION_AUTH") {
    return;
  }

  chrome.storage.local.get(["pollyPendingState"], ({ pollyPendingState }) => {
    const incomingState = message.payload?.state;
    if (!incomingState || !pollyPendingState || incomingState !== pollyPendingState) {
      sendResponse({ ok: false, error: "State mismatch." });
      return;
    }

    chrome.storage.local.set(
      {
        [STORAGE_KEY]: {
          accessToken: message.payload.access_token,
          expiresAt: message.payload.expires_at,
          user: message.payload.user
        },
        pollyPendingState: null
      },
      () => sendResponse({ ok: true })
    );
  });

  return true;
});
