"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({ children }: { children: string }) {
  return (
    <div className="space-y-3">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children: content }) => (
            <h1 className="mt-2 text-xl font-semibold tracking-tight">{content}</h1>
          ),
          h2: ({ children: content }) => (
            <h2 className="mt-6 border-b border-line/60 pb-1 text-base font-semibold tracking-tight">
              {content}
            </h2>
          ),
          h3: ({ children: content }) => (
            <h3 className="mt-4 text-sm font-semibold">{content}</h3>
          ),
          p: ({ children: content }) => (
            <p className="text-sm leading-relaxed text-ink/90">{content}</p>
          ),
          ul: ({ children: content }) => (
            <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-ink/90">{content}</ul>
          ),
          ol: ({ children: content }) => (
            <ol className="list-decimal space-y-1 pl-5 text-sm leading-relaxed text-ink/90">{content}</ol>
          ),
          li: ({ children: content }) => <li className="pl-1">{content}</li>,
          strong: ({ children: content }) => <strong className="font-semibold text-ink">{content}</strong>,
          a: ({ children: content, href }) => (
            <a className="link" href={href} rel="noreferrer noopener" target="_blank">
              {content}
            </a>
          ),
          code: ({ children: content, className }) => {
            const isBlock = Boolean(className?.includes("language-"));
            if (isBlock) {
              return <code className="block whitespace-pre font-mono text-[11.5px]">{content}</code>;
            }
            return (
              <code className="rounded bg-raised px-1 py-0.5 font-mono text-[11.5px] text-ink">
                {content}
              </code>
            );
          },
          pre: ({ children: content }) => (
            <pre className="max-h-[480px] overflow-auto rounded-lg border border-line/70 bg-canvas/80 p-3 font-mono text-[11.5px] leading-relaxed text-ink/85">
              {content}
            </pre>
          ),
          table: ({ children: content }) => (
            <div className="overflow-x-auto rounded-lg border border-line/70">
              <table className="min-w-full text-left text-xs">{content}</table>
            </div>
          ),
          thead: ({ children: content }) => (
            <thead className="bg-raised/60 text-[10px] uppercase tracking-wider text-muted">{content}</thead>
          ),
          th: ({ children: content }) => <th className="border-b border-line/60 px-2.5 py-2 font-medium">{content}</th>,
          td: ({ children: content }) => <td className="border-b border-line/40 px-2.5 py-2 align-top">{content}</td>,
          blockquote: ({ children: content }) => (
            <blockquote className="border-l-2 border-citron/50 pl-3 text-sm text-muted">{content}</blockquote>
          ),
          hr: () => <hr className="border-line/60" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
