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

export interface ResultEvent {
  type: "result"
  id: string
  title: string
  pages: number
  size: string
  platform: "slideshare" | "scribd"
}

export interface ErrorEvent {
  type: "error"
  message: string
}

export type StreamEvent = LogEvent | ProgressEvent | ResultEvent | ErrorEvent

export type Logger = (level: LogLevel, message: string) => void
export type ProgressReporter = (current: number, total: number, label: string) => void
