import { NextRequest, NextResponse } from "next/server";
import { customAlphabet } from "nanoid";
import { savePage } from "@/lib/pages-store";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const html = typeof body?.html === "string" ? body.html : "";
  const prompt = typeof body?.prompt === "string" ? body.prompt : "";

  if (!html) {
    return NextResponse.json({ error: "html is required." }, { status: 400 });
  }

  const slug = nanoid();
  await savePage({ slug, html, prompt, createdAt: new Date().toISOString() });

  return NextResponse.json({ slug, url: `/p/${slug}` });
}
