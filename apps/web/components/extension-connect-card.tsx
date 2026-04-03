"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Props = {
  state: string;
  userEmail: string;
};

type BridgeStatus = "idle" | "connecting" | "connected" | "error";

export function ExtensionConnectCard({ state, userEmail }: Props) {
  const [status, setStatus] = useState<BridgeStatus>("idle");
  const [message, setMessage] = useState("Click below to connect this browser to Polly.");
  const attemptedRef = useRef(false);

  const helper = useMemo(() => {
    if (status === "connected") {
      return "You can return to the extension popup now.";
    }
    return message;
  }, [message, status]);

  async function handleConnect() {
    setStatus("connecting");
    setMessage("Creating extension token...");

    try {
      const response = await fetch(`/api/ext/token?state=${encodeURIComponent(state)}`, {
        method: "GET",
        credentials: "include"
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || "Failed to create extension token.");
      }

      window.postMessage(
        {
          type: "POLLY_EXTENSION_AUTH",
          state: data.state,
          access_token: data.access_token,
          expires_at: data.expires_at,
          user: data.user
        },
        window.location.origin
      );

      setStatus("connected");
      setMessage(`Connected as ${userEmail}.`);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Failed to connect extension.");
    }
  }

  useEffect(() => {
    if (!state || attemptedRef.current || status !== "idle") {
      return;
    }

    attemptedRef.current = true;
    void handleConnect();
  }, [state, status]);

  return (
    <section className="card" style={{ maxWidth: 680, margin: "80px auto 0" }}>
      <div className="eyebrow">Extension bridge</div>
      <h1 className="title-lg">Connect the current browser to Polly.</h1>
      <p className="subtitle">{helper}</p>
      <div className="actions">
        <button className="button" onClick={handleConnect} type="button">
          {status === "connecting" ? "Connecting..." : "Connect extension"}
        </button>
        <a className="button secondary" href="/dashboard">
          Back to dashboard
        </a>
      </div>
      <p className="muted" style={{ marginTop: 18 }}>
        Signed in as {userEmail}
      </p>
    </section>
  );
}
