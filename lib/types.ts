export type LogLevel = "info" | "success" | "warn" | "error" | "step"

export interface LogEvent {
  type: "log"
  level: LogLevel
  message: string
  timestamp: number
}

export interface ProgressEvent {
  type: "progress"
  current: number
  total: number
  label: string
}

export type OutputFormat = "pdf" | "pptx"

export interface DownloadOptions {
  format: OutputFormat
  uploadToCatbox: boolean
  /** Optional catbox.moe account userhash for permanent storage. */
  catboxUserhash?: string
}

export interface ResultEvent {
  type: "result"
  id: string
  title: string
  pages: number
  size: string
  platform: "slideshare" | "scribd"
  format: OutputFormat
  catboxUrl?: string
  /** Set when the file was stored on litterbox (anonymous tier) and will expire. */
  catboxExpiresAt?: number
  /**
   * Base64-encoded file bytes delivered inline with the result. Required on
   * serverless hosting where /tmp is not shared between function instances,
   * so a follow-up request to /api/file/[id] may land on an instance that
   * never saw the file ("File not found or expired").
   */
  fileBase64?: string
}

export interface ErrorEvent {
  type: "error"
  message: string
}

export type StreamEvent = LogEvent | ProgressEvent | ResultEvent | ErrorEvent

export type Logger = (level: LogLevel, message: string) => void
export type ProgressReporter = (current: number, total: number, label: string) => void
