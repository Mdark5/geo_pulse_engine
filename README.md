# Landing Page Generator

Describe your product in a sentence, get an AI-generated landing page, publish it to a shareable URL. Built as a scrappy MVP to test demand before investing in anything else.

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in ANTHROPIC_API_KEY
npm run dev
```

Open http://localhost:3000, type a description, click **Generate**, then **Publish** to get a shareable link at `/p/<slug>`.

## How it works

- `app/page.tsx` — prompt input, Generate button, live preview.
- `app/api/generate/route.ts` — sends the prompt to Claude and returns a self-contained HTML landing page.
- `app/api/publish/route.ts` — saves the generated HTML under a short slug.
- `app/p/[slug]/route.ts` — serves the published HTML directly at a shareable URL.
- `lib/pages-store.ts` — file-based storage (`data/pages.json`) for published pages. Fine for an MVP on a single running instance; swap for a real database before scaling.

## Deploying with Docker

```bash
cp .env.example .env   # fill in ANTHROPIC_API_KEY
docker compose up -d --build
```

This builds a multi-stage image using Next.js's `output: "standalone"` build
(minimal runtime, no dev dependencies), runs as a non-root user, and persists
published pages (`data/pages.json`) in the `landing-page-data` named volume so
they survive rebuilds/restarts. The app listens on port 3000
(`http://localhost:3000`).

To run the image directly instead of via compose:

```bash
docker build -t geo-pulse-landing .
docker run -d -p 3000:3000 \
  -e ANTHROPIC_API_KEY=your-key \
  -v landing-page-data:/app/data \
  --name geo-pulse-landing geo-pulse-landing
```

Note: the file-based store means published pages live on one instance's
volume — this is fine for a single container, but don't run multiple
replicas behind a load balancer without swapping `lib/pages-store.ts` for a
shared database first (see note below).

## Metric that matters right now

Number of users who generated **and** published a landing page. Nothing else is in scope until that number tells us something.

## Other components in this repo

- `market-ingestion/` — a standalone real-time ingestion service that streams Bitget futures market data into the `supabase/migrations/` schema. Unrelated to the landing-page generator above; see `market-ingestion/README.md`.
