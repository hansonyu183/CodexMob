"use client";

import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

interface MarkdownMessageProps {
  content: string;
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-white/10 bg-zinc-900">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-xs text-zinc-300">
        <span>{language || "text"}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="rounded-md border border-white/20 px-2 py-1 text-[11px] hover:bg-white/10"
        >
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre className="max-w-full overflow-x-auto p-3 text-sm leading-6">
        <code className={language ? `language-${language} block min-w-max` : "block min-w-max"}>
          {code}
        </code>
      </pre>
    </div>
  );
}

export function MarkdownMessage({ content }: MarkdownMessageProps) {
  const safeContent = useMemo(() => content || "", [content]);

  return (
    <div className="min-w-0 break-words [overflow-wrap:anywhere]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          code(props) {
            const { className, children } = props;
            const raw = String(children).replace(/\n$/, "");
            const matched = /language-(\w+)/.exec(className ?? "");
            const language = matched?.[1] ?? "";

            if (!className) {
              return (
                <code className="rounded-md bg-black/30 px-1.5 py-0.5 font-mono text-[13px] break-words [overflow-wrap:anywhere]">
                  {raw}
                </code>
              );
            }

            return <CodeBlock language={language} code={raw} />;
          },
          p(props) {
            return (
              <p
                className="mb-2 whitespace-pre-wrap break-words leading-7 [overflow-wrap:anywhere]"
                {...props}
              />
            );
          },
          li(props) {
            return <li className="break-words [overflow-wrap:anywhere]" {...props} />;
          },
          a(props) {
            return <a className="break-all underline" {...props} />;
          },
        }}
      >
        {safeContent}
      </ReactMarkdown>
    </div>
  );
}
