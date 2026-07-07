import { NextRequest, NextResponse } from "next/server";
import { getPage } from "@/lib/pages-store";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const page = await getPage(slug);
  if (!page) {
    return new NextResponse("Page not found.", { status: 404 });
  }
  return new NextResponse(page.html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
