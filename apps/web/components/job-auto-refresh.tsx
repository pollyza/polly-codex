"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { JobStatus } from "@/lib/types";

export function JobAutoRefresh({ status }: { status: JobStatus }) {
  const router = useRouter();

  useEffect(() => {
    if (status === "succeeded" || status === "failed") {
      return;
    }

    const timer = window.setTimeout(() => {
      router.refresh();
    }, 3000);

    return () => window.clearTimeout(timer);
  }, [router, status]);

  return null;
}
