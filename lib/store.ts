import { mkdir, writeFile, readFile, readdir, stat, unlink } from "fs/promises"
import { existsSync } from "fs"
import path from "path"
import os from "os"
import crypto from "crypto"

const STORE_DIR = path.join(os.tmpdir(), "docgrab-store")
const MAX_AGE_MS = 60 * 60 * 1000 // 1 hour

async function ensureDir() {
  if (!existsSync(STORE_DIR)) {
    await mkdir(STORE_DIR, { recursive: true })
  }
}

export function slugify(text: string): string {
  const cleaned = text
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .slice(0, 80)
  return cleaned || "document"
}

export async function savePdf(pdf: Buffer, title: string): Promise<string> {
  await ensureDir()
  const id = `${slugify(title)}_${crypto.randomBytes(4).toString("hex")}`
  await writeFile(path.join(STORE_DIR, `${id}.pdf`), pdf)
  // Fire-and-forget cleanup of stale files
  cleanupOldFiles().catch(() => {})
  return id
}

export async function getPdf(id: string): Promise<Buffer | null> {
  // Sanitize: only allow safe id characters, prevent path traversal
  if (!/^[\w-]+$/.test(id)) return null
  const filepath = path.join(STORE_DIR, `${id}.pdf`)
  try {
    return await readFile(filepath)
  } catch {
    return null
  }
}

export async function cleanupOldFiles(): Promise<void> {
  try {
    await ensureDir()
    const now = Date.now()
    const files = await readdir(STORE_DIR)
    await Promise.allSettled(
      files.map(async (f) => {
        const fp = path.join(STORE_DIR, f)
        const s = await stat(fp)
        if (now - s.mtimeMs > MAX_AGE_MS) {
          await unlink(fp)
        }
      }),
    )
  } catch {
    // best-effort cleanup
  }
}
