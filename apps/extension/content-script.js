window.addEventListener("message", (event) => {
  if (event.source !== window) {
    return;
  }

  const data = event.data;
  if (!data || data.type !== "POLLY_EXTENSION_AUTH") {
    return;
  }

  chrome.runtime.sendMessage({
    type: "POLLY_EXTENSION_AUTH",
    payload: data
  });
});
