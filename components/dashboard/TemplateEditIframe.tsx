"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

type TemplateEditIframeProps = {
  title: string;
  srcDoc: string;
};

export function TemplateEditIframe({ title, srcDoc }: TemplateEditIframeProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const router = useRouter();

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const frame = iframeRef.current;
      if (!frame?.contentWindow || event.source !== frame.contentWindow) return;
      const payload = event.data;
      if (!payload || typeof payload !== "object" || payload.type !== "shm_template_saved") return;
      const url =
        typeof payload.url === "string" && payload.url.startsWith("/")
          ? payload.url
          : "/dashboard/templates";
      router.push(url);
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [router]);

  return (
    <iframe
      ref={iframeRef}
      title={title}
      srcDoc={srcDoc}
      className="h-[calc(100vh-3.5rem)] min-h-[800px] w-full border-0"
      sandbox="allow-scripts allow-forms allow-same-origin allow-downloads allow-popups"
    />
  );
}
