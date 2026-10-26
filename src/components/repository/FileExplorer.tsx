"use client";

import { useEffect, useMemo, useRef, useState } from "react";

interface FilePayload {
  path: string;
  content: string;
  bytes: number;
  truncated: boolean;
  lineCount: number;
  secretMatches: { rule: string; line: number; preview: string }[];
}

export function FileExplorer({ repositoryId }: { repositoryId: string }) {
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [file, setFile] = useState<FilePayload | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const viewerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/repositories/${repositoryId}/files?limit=800`);
        const payload = (await response.json()) as { files?: string[]; error?: { message: string } };
        if (cancelled) return;
        if (!response.ok || !payload.files) {
          setError(payload.error?.message ?? "The file list could not be loaded.");
        } else {
          setFiles(payload.files);
        }
      } catch {
        if (!cancelled) setError("The file list could not be loaded.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repositoryId]);

  async function openFile(path: string) {
    setSelected(path);
    setFile(null);
    setFileError(null);
    setFileLoading(true);
    try {
      const response = await fetch(
        `/api/repositories/${repositoryId}/file?path=${encodeURIComponent(path)}`,
      );
      const payload = (await response.json()) as FilePayload & { error?: { message: string } };
      if (!response.ok) {
        setFileError(payload.error?.message ?? "The file could not be opened.");
      } else {
        setFile(payload);
      }
    } catch {
      setFileError("The file could not be opened.");
    } finally {
      setFileLoading(false);
    }
  }

  const filtered = useMemo(() => {
    if (!query.trim()) return files;
    const needle = query.trim().toLowerCase();
    return files.filter((path) => path.toLowerCase().includes(needle));
  }, [files, query]);

  const lines = file ? file.content.split("\n") : [];
  const shownLines = lines.slice(0, 1500);

  return (
    <div className="grid min-h-[420px] gap-0 md:grid-cols-[280px_minmax(0,1fr)]">
      <div className="border-b border-line/60 md:border-b-0 md:border-r">
        <div className="border-b border-line/60 p-2">
          <input
            className="input text-xs"
            placeholder="Filter files…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Filter tracked files"
          />
        </div>
        <div className="max-h-[420px] overflow-auto p-1.5 scrollbar-thin" role="listbox" aria-label="Tracked files">
          {loading ? <p className="px-2 py-3 text-xs text-muted">Loading tracked files…</p> : null}
          {error ? <p className="px-2 py-3 text-xs text-danger">{error}</p> : null}
          {!loading && !error && filtered.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted">No matching tracked files.</p>
          ) : null}
          {filtered.map((path) => (
            <button
              key={path}
              type="button"
              role="option"
              aria-selected={selected === path}
              onClick={() => void openFile(path)}
              className={`block w-full truncate rounded px-2 py-1 text-left font-mono text-[11px] ${
                selected === path ? "bg-citron/10 text-citron" : "text-muted hover:bg-raised hover:text-ink"
              }`}
              title={path}
            >
              {path}
            </button>
          ))}
        </div>
      </div>

      <div ref={viewerRef} className="min-w-0">
        {!selected ? (
          <div className="flex h-full min-h-[300px] items-center justify-center px-6 text-center text-sm text-muted">
            Select a tracked file to inspect it. Excluded paths are never returned.
          </div>
        ) : (
          <div className="space-y-2 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="truncate font-mono text-[11px] text-ink">{selected}</p>
              <p className="font-mono text-[10px] text-muted">
                {file ? `${file.lineCount} lines · ${Math.round(file.bytes / 1024)} KB` : ""}
              </p>
            </div>

            {file?.secretMatches && file.secretMatches.length > 0 ? (
              <div className="rounded border border-warn/40 bg-warn/10 px-3 py-2 text-[11px] text-warn">
                {file.secretMatches.length} credential-like pattern(s) detected in this file. They are
                redacted before any content is sent to a model. Values are not reproduced.
              </div>
            ) : null}

            {fileLoading ? <p className="text-xs text-muted">Loading…</p> : null}
            {fileError ? <p className="text-xs text-danger">{fileError}</p> : null}

            {file ? (
              <>
                <div className="max-h-[520px] overflow-auto rounded-lg border border-line/70 bg-canvas/80">
                  <pre className="min-w-full p-0 font-mono text-[11.5px] leading-[1.6]">
                    <code>
                      {shownLines.map((line, index) => (
                        <span key={index} className="flex">
                          <span className="sticky left-0 w-11 shrink-0 select-none border-r border-line/50 bg-canvas px-2 text-right text-muted/60">
                            {index + 1}
                          </span>
                          <span className="whitespace-pre px-3 text-ink/90">{line || " "}</span>
                        </span>
                      ))}
                    </code>
                  </pre>
                </div>
                {lines.length > shownLines.length ? (
                  <p className="text-[11px] text-muted">
                    Showing the first {shownLines.length} of {lines.length} lines.
                  </p>
                ) : null}
                {file.truncated ? (
                  <p className="text-[11px] text-warn">The file was truncated at the server limit.</p>
                ) : null}
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}