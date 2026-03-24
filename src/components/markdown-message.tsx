"use client";

import {
  Children,
  isValidElement,
  memo,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownMessageProps {
  content: string;
  resolveAttachmentHref?: (path: string) => string | null;
  onOpenAttachment?: (href: string, label: string) => void;
}

const WINDOWS_PATH_REGEX = /[A-Za-z]:(?:\\|\/)[^\s"'<>|?*]+/g;
const UNC_PATH_REGEX = /\\\\[^\s"'<>|?*]+/g;
const WINDOWS_ABS_PATH = /^[A-Za-z]:/;
const UNC_ABS_PATH = /^\\\\[^\\]+\\[^\\]+/;
const FILE_SCHEME = /^file:\/\//i;
const MARKDOWN_REMARK_PLUGINS = [remarkGfm];
let highlightPluginPromise: Promise<unknown> | null = null;

function loadHighlightPlugin() {
  if (!highlightPluginPromise) {
    highlightPluginPromise = import("rehype-highlight").then((mod) => mod.default);
  }
  return highlightPluginPromise;
}

function toWindowsAbsolutePath(value: string): string | null {
  if (!/^[A-Za-z]:/.test(value)) {
    return null;
  }

  const drive = value.slice(0, 2);
  const rest = value.slice(2).trim();
  if (!rest) {
    return null;
  }

  const normalizedRest = (rest.startsWith("\\") || rest.startsWith("/"))
    ? rest
    : `\\${rest}`;

  return `${drive}${normalizedRest}`.replaceAll("/", "\\");
}

function decodeFileHrefToPath(value: string): string | null {
  if (!FILE_SCHEME.test(value)) {
    return null;
  }
  try {
    const decoded = decodeURI(value.replace(/^file:\/+/, ""));
    if (!decoded) {
      return null;
    }
    if (/^[A-Za-z]:/.test(decoded)) {
      return decoded.replaceAll("/", "\\");
    }
    return `\\\\${decoded.replaceAll("/", "\\")}`;
  } catch {
    return null;
  }
}

function normalizeLocalPathCandidate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  let decoded = trimmed;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch {
    decoded = trimmed;
  }
  const fromFileHref = decodeFileHrefToPath(decoded);
  if (fromFileHref) {
    return fromFileHref;
  }

  if (decoded.startsWith("/") && WINDOWS_ABS_PATH.test(decoded.slice(1))) {
    const normalized = toWindowsAbsolutePath(decoded.slice(1));
    if (normalized) {
      return normalized;
    }
  }

  if (WINDOWS_ABS_PATH.test(decoded)) {
    const normalized = toWindowsAbsolutePath(decoded);
    if (normalized) {
      return normalized;
    }
  }

  if (UNC_ABS_PATH.test(decoded)) {
    return decoded.replaceAll("/", "\\");
  }

  return null;
}

export function normalizeLocalPathCandidateForTests(value: string): string | null {
  return normalizeLocalPathCandidate(value);
}

function linkifyLocalPaths(input: string): Array<string | { text: string; path: string }> {
  const matches: Array<{ start: number; end: number; text: string }> = [];
  const collect = (regex: RegExp) => {
    for (const match of input.matchAll(regex)) {
      const text = match[0];
      const idx = match.index ?? -1;
      if (idx < 0) {
        continue;
      }
      matches.push({
        start: idx,
        end: idx + text.length,
        text,
      });
    }
  };
  collect(WINDOWS_PATH_REGEX);
  collect(UNC_PATH_REGEX);

  if (matches.length === 0) {
    return [input];
  }

  matches.sort((left, right) => left.start - right.start);
  const merged: Array<{ start: number; end: number; text: string }> = [];
  for (const current of matches) {
    const last = merged[merged.length - 1];
    if (!last || current.start >= last.end) {
      merged.push(current);
      continue;
    }
    if (current.end > last.end) {
      last.end = current.end;
      last.text = input.slice(last.start, last.end);
    }
  }

  const output: Array<string | { text: string; path: string }> = [];
  let cursor = 0;
  for (const item of merged) {
    if (item.start > cursor) {
      output.push(input.slice(cursor, item.start));
    }
    output.push({
      text: item.text,
      path: item.text,
    });
    cursor = item.end;
  }
  if (cursor < input.length) {
    output.push(input.slice(cursor));
  }
  return output;
}

function renderLinkifiedText(
  value: string,
  keyPrefix: string,
  resolveAttachmentHref?: (path: string) => string | null,
  onOpenAttachment?: (href: string, label: string) => void,
): ReactNode[] {
  const parts = linkifyLocalPaths(value);
  return parts.map((part, index) =>
    typeof part === "string" ? (
      <span key={`${keyPrefix}-plain-${index}`}>{part}</span>
    ) : (
      (() => {
        const href = resolveAttachmentHref?.(part.path) ?? null;
        if (!href) {
          return <span key={`${keyPrefix}-path-plain-${index}`}>{part.text}</span>;
        }
        return (
          <span
            key={`${keyPrefix}-path-${index}`}
            role="button"
            tabIndex={0}
            onClick={() => onOpenAttachment?.(href, part.text)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpenAttachment?.(href, part.text);
              }
            }}
            className="cursor-pointer break-all text-left underline"
          >
            {part.text}
          </span>
        );
      })()
    ),
  );
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

export const MarkdownMessage = memo(function MarkdownMessage({
  content,
  resolveAttachmentHref,
  onOpenAttachment,
}: MarkdownMessageProps) {
  const safeContent = useMemo(() => content || "", [content]);
  const [highlightPlugin, setHighlightPlugin] = useState<unknown | null>(null);
  const needsHighlight = safeContent.includes("```");

  useEffect(() => {
    if (!needsHighlight) {
      return;
    }
    let canceled = false;
    void loadHighlightPlugin().then((plugin) => {
      if (!canceled) {
        setHighlightPlugin(plugin);
      }
    });
    return () => {
      canceled = true;
    };
  }, [needsHighlight]);

  const rehypePlugins = useMemo(
    () => (highlightPlugin ? [highlightPlugin as never] : []),
    [highlightPlugin],
  );

  return (
    <div className="message-text min-w-0 select-text break-words [overflow-wrap:anywhere]">
      <ReactMarkdown
        remarkPlugins={MARKDOWN_REMARK_PLUGINS}
        rehypePlugins={rehypePlugins}
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
            const renderedChildren = Children.map(props.children, (child, index) => {
              if (typeof child === "string") {
                return renderLinkifiedText(
                  child,
                  `p-${index}`,
                  resolveAttachmentHref,
                  onOpenAttachment,
                );
              }
              if (isValidElement(child)) {
                return child;
              }
              return child;
            });
            return (
              <p className="mb-2 whitespace-pre-wrap break-words leading-7 [overflow-wrap:anywhere]">
                {renderedChildren}
              </p>
            );
          },
          li(props) {
            return <li className="break-words [overflow-wrap:anywhere]" {...props} />;
          },
          a(props) {
            const href = typeof props.href === "string" ? props.href : "";
            const localPath = normalizeLocalPathCandidate(href);
            if (localPath) {
              const resolvedHref = resolveAttachmentHref?.(localPath) ?? null;
              if (!resolvedHref) {
                return <span className="break-all">{props.children}</span>;
              }
              return (
                <span
                  role="button"
                  tabIndex={0}
                  className="cursor-pointer break-all text-left underline"
                  onClick={() => {
                    onOpenAttachment?.(resolvedHref, localPath);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onOpenAttachment?.(resolvedHref, localPath);
                    }
                  }}
                >
                  {props.children}
                </span>
              );
            }
            return <a className="break-all underline" target="_blank" rel="noreferrer noopener" {...props} />;
          },
        }}
      >
        {safeContent}
      </ReactMarkdown>
    </div>
  );
});

MarkdownMessage.displayName = "MarkdownMessage";
