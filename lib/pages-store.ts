import { promises as fs } from "fs";
import path from "path";

export type PublishedPage = {
  slug: string;
  html: string;
  prompt: string;
  createdAt: string;
};

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "pages.json");

async function readAll(): Promise<Record<string, PublishedPage>> {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

async function writeAll(pages: Record<string, PublishedPage>): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(pages, null, 2), "utf-8");
}

export async function savePage(page: PublishedPage): Promise<void> {
  const pages = await readAll();
  pages[page.slug] = page;
  await writeAll(pages);
}

export async function getPage(slug: string): Promise<PublishedPage | null> {
  const pages = await readAll();
  return pages[slug] ?? null;
}
