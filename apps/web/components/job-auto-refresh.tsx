"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { JobStatus } from "@/lib/types";

export function JobAutoRefresh({ status, jobId }: { status: JobStatus; jobId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (status === "succeeded" || status === "failed") {
      return;
    }

    const timer = window.setTimeout(async () => {
      const deviceId = searchParams.get("device_id");
      const response = await fetch(`/api/jobs/${jobId}?advance=1`, {
        headers: deviceId ? { "x-polly-device-id": deviceId } : undefined,
        cache: "no-store"
      }).catch(() => null);

      if (!response?.ok) {
        router.refresh();
        return;
      }

      router.refresh();
    }, 3000);

    return () => window.clearTimeout(timer);
  }, [jobId, router, searchParams, status]);

  return null;
}
