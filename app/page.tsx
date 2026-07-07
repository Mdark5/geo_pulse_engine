"use client";

import { useState } from "react";

type Status = "idle" | "generating" | "publishing";

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [html, setHtml] = useState<string | null>(null);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");

  const generate = async () => {
    if (!prompt.trim() || status !== "idle") return;
    setStatus("generating");
    setError(null);
    setPublishedUrl(null);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed.");
      setHtml(data.html);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed.");
    } finally {
      setStatus("idle");
    }
  };

  const publish = async () => {
    if (!html || status !== "idle") return;
    setStatus("publishing");
    setError(null);
    try {
      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html, prompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Publish failed.");
      setPublishedUrl(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Publish failed.");
    } finally {
      setStatus("idle");
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-black/10 dark:border-white/10 px-6 py-4">
        <h1 className="text-lg font-semibold">Landing Page Generator</h1>
        <p className="text-sm opacity-70">
          Describe your product. Get a landing page. Publish it in one click.
        </p>
      </header>

      <main className="flex flex-1 flex-col gap-4 p-6 md:flex-row">
        <section className="flex w-full flex-col gap-3 md:w-80">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. A subscription box for artisanal hot sauce, playful and bold tone"
            rows={6}
            className="w-full resize-none rounded-md border border-black/15 dark:border-white/15 bg-transparent p-3 text-sm outline-none focus:border-black/40 dark:focus:border-white/40"
          />
          <button
            onClick={generate}
            disabled={!prompt.trim() || status !== "idle"}
            className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-40"
          >
            {status === "generating" ? "Generating…" : "Generate"}
          </button>

          {html && (
            <button
              onClick={publish}
              disabled={status !== "idle"}
              className="rounded-md border border-black/15 dark:border-white/15 px-4 py-2 text-sm font-medium disabled:opacity-40"
            >
              {status === "publishing" ? "Publishing…" : "Publish"}
            </button>
          )}

          {publishedUrl && (
            <a
              href={publishedUrl}
              target="_blank"
              rel="noreferrer"
              className="break-all rounded-md bg-green-600/10 p-3 text-sm text-green-700 dark:text-green-400 underline"
            >
              {typeof window !== "undefined" ? window.location.origin : ""}
              {publishedUrl}
            </a>
          )}

          {error && (
            <p className="rounded-md bg-red-600/10 p-3 text-sm text-red-700 dark:text-red-400">
              {error}
            </p>
          )}
        </section>

        <section className="flex-1 rounded-md border border-black/15 dark:border-white/15 overflow-hidden">
          {html ? (
            <iframe srcDoc={html} title="Preview" className="h-full w-full border-0" />
          ) : (
            <div className="flex h-full min-h-96 items-center justify-center text-sm opacity-50">
              Your generated landing page will preview here.
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
