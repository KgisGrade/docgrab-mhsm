"use client"

import { useState, useRef, useCallback } from "react"
import { Link2, Loader2 } from "lucide-react"
import { LogConsole, type LogEntry } from "./log-console"
import { ResultCard, type GrabResult } from "./result-card"
import type { StreamEvent } from "@/lib/types"

type Status = "idle" | "running" | "done" | "error"

function detectPlatformLabel(url: string): string | null {
  const lower = url.toLowerCase()
  if (lower.includes("slideshare")) return "slideshare"
  if (lower.includes("scribd")) return "scribd"
  return null
}

export function Downloader() {
  const [url, setUrl] = useState("")
  const [status, setStatus] = useState<Status>("idle")
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [progress, setProgress] = useState<{ current: number; total: number; label: string } | null>(null)
  const [result, setResult] = useState<GrabResult | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const platform = detectPlatformLabel(url)
  const isRunning = status === "running"

  const addLog = useCallback((entry: LogEntry) => {
    setLogs((prev) => [...prev, entry])
  }, [])

  const handleEvent = useCallback(
    (event: StreamEvent) => {
      switch (event.type) {
        case "log":
          addLog({ level: event.level, message: event.message, timestamp: event.timestamp })
          if (event.level === "step") setProgress(null)
          break
        case "progress":
          setProgress({ current: event.current, total: event.total, label: event.label })
          break
        case "result":
          setResult({
            id: event.id,
            title: event.title,
            pages: event.pages,
            size: event.size,
            platform: event.platform,
          })
          setProgress(null)
          setStatus("done")
          break
        case "error":
          setProgress(null)
          setStatus("error")
          break
      }
    },
    [addLog],
  )

  const grab = useCallback(async () => {
    if (!url.trim() || isRunning) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setStatus("running")
    setLogs([])
    setResult(null)
    setProgress(null)

    try {
      const resp = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
        signal: controller.signal,
      })

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({ error: `Request failed (HTTP ${resp.status})` }))
        addLog({ level: "error", message: data.error ?? "Request failed", timestamp: Date.now() })
        setStatus("error")
        return
      }

      if (!resp.body) {
        addLog({ level: "error", message: "No response stream received", timestamp: Date.now() })
        setStatus("error")
        return
      }

      // Parse NDJSON stream line by line
      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            handleEvent(JSON.parse(line) as StreamEvent)
          } catch {
            // skip malformed lines
          }
        }
      }
      if (buffer.trim()) {
        try {
          handleEvent(JSON.parse(buffer) as StreamEvent)
        } catch {
          // skip malformed trailing data
        }
      }

      // If stream ended without a result or error event, mark as error
      setStatus((prev) => (prev === "running" ? "error" : prev))
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return
      addLog({
        level: "error",
        message: e instanceof Error ? e.message : "Connection lost",
        timestamp: Date.now(),
      })
      setStatus("error")
    }
  }, [url, isRunning, addLog, handleEvent])

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          grab()
        }}
        className="flex flex-col sm:flex-row gap-2"
      >
        <div className="relative flex-1">
          <Link2
            className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.slideshare.net/... or https://www.scribd.com/document/..."
            aria-label="Document URL"
            disabled={isRunning}
            className="w-full rounded-md border border-input bg-card pl-9 pr-20 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
          />
          {platform && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 rounded bg-muted px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              {platform}
            </span>
          )}
        </div>
        <button
          type="submit"
          disabled={!url.trim() || isRunning}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isRunning ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Grabbing
            </>
          ) : (
            "Grab"
          )}
        </button>
      </form>

      {result && status === "done" && <ResultCard result={result} />}

      <LogConsole logs={logs} isRunning={isRunning} progress={progress} />
    </div>
  )
}
