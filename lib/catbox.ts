import type { Logger } from "./types"

// catbox.moe rejects uploads larger than 200 MB.
export const CATBOX_LIMIT_BYTES = 200 * 1024 * 1024

const CATBOX_API = "https://catbox.moe/user/api.php"

export interface CatboxResult {
  url?: string
  error?: string
}

/**
 * Upload a file buffer to catbox.moe for permanent, host-free storage.
 * Returns the direct file URL on success, or an error message on failure.
 */
export async function uploadToCatbox(
  buffer: Buffer,
  fileName: string,
  contentType: string,
  log: Logger,
): Promise<CatboxResult> {
  const sizeMb = buffer.length / 1024 / 1024

  if (buffer.length > CATBOX_LIMIT_BYTES) {
    const msg = `File is ${sizeMb.toFixed(1)} MB, over catbox.moe's 200 MB limit — upload skipped`
    log("error", msg)
    return { error: msg }
  }

  log("step", `Uploading ${sizeMb.toFixed(1)} MB to catbox.moe...`)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 120000)

  try {
    const form = new FormData()
    form.append("reqtype", "fileupload")
    form.append("fileToUpload", new Blob([new Uint8Array(buffer)], { type: contentType }), fileName)

    const resp = await fetch(CATBOX_API, {
      method: "POST",
      body: form,
      signal: controller.signal,
    })

    const text = (await resp.text()).trim()

    if (!resp.ok) {
      const msg = `catbox.moe upload failed (HTTP ${resp.status})`
      log("error", msg)
      return { error: msg }
    }

    if (!/^https?:\/\/(files\.)?catbox\.moe\/\S+$/i.test(text)) {
      const msg = `catbox.moe returned an unexpected response: ${text.slice(0, 120) || "empty"}`
      log("error", msg)
      return { error: msg }
    }

    log("success", `Uploaded to catbox.moe: ${text}`)
    return { url: text }
  } catch (e) {
    const msg =
      e instanceof DOMException && e.name === "AbortError"
        ? "catbox.moe upload timed out"
        : `catbox.moe upload error: ${e instanceof Error ? e.message : "unknown error"}`
    log("error", msg)
    return { error: msg }
  } finally {
    clearTimeout(timer)
  }
}
