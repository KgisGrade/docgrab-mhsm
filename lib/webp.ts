/**
 * Pure-WASM WebP -> JPEG transcoder.
 *
 * SlideShare serves its highest-resolution (2048px) slide variants only as
 * WebP. We previously used `sharp`, but sharp depends on the native libvips
 * shared library which is NOT present in Vercel's serverless runtime, so the
 * transcode threw ("libvips-cpp.so...: cannot open shared object file") and the
 * pipeline silently fell back to the low-res 638px JPEG.
 *
 * @jsquash's mozjpeg/webp codecs are WebAssembly and run identically on any
 * platform. The .wasm files ship inside the packages; we compile them once from
 * disk (never fetched at runtime) and reuse the compiled modules.
 */
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)

let initPromise: Promise<{
  decodeWebp: (data: ArrayBuffer) => Promise<ImageData>
  encodeJpeg: (data: ImageData, opts?: { quality?: number }) => Promise<ArrayBuffer>
}> | null = null

async function getCodecs() {
  if (!initPromise) {
    initPromise = (async () => {
      const [webpDecode, jpegEncode] = await Promise.all([
        import("@jsquash/webp/decode.js"),
        import("@jsquash/jpeg/encode.js"),
      ])

      const webpWasmPath = require.resolve("@jsquash/webp/codec/dec/webp_dec.wasm")
      const jpegWasmPath = require.resolve("@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm")

      const [webpModule, jpegModule] = await Promise.all([
        WebAssembly.compile(await readFile(webpWasmPath)),
        WebAssembly.compile(await readFile(jpegWasmPath)),
      ])

      await Promise.all([webpDecode.init(webpModule), jpegEncode.init(jpegModule)])

      return {
        decodeWebp: webpDecode.default as (data: ArrayBuffer) => Promise<ImageData>,
        encodeJpeg: jpegEncode.default as (data: ImageData, opts?: { quality?: number }) => Promise<ArrayBuffer>,
      }
    })()
  }
  return initPromise
}

/** Transcode a WebP buffer to a high-quality JPEG buffer. Returns null on failure. */
export async function webpToJpeg(webp: Buffer, quality = 92): Promise<Buffer | null> {
  try {
    const { decodeWebp, encodeJpeg } = await getCodecs()
    const ab = webp.buffer.slice(webp.byteOffset, webp.byteOffset + webp.byteLength) as ArrayBuffer
    const image = await decodeWebp(ab)
    const jpeg = await encodeJpeg(image, { quality })
    return Buffer.from(jpeg)
  } catch {
    return null
  }
}
