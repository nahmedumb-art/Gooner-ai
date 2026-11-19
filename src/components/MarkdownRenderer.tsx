import React, { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { Check, Copy, Download, Eye, PanelRightOpen } from "lucide-react";
import type { CanvasArtifact } from "../types";

interface MarkdownRendererProps {
  content: string;
  onOpenCanvas?: (artifact: CanvasArtifact, initialTab?: "code" | "preview") => void;
}

function isPreviewableLanguage(lang: string): boolean {
  const normalized = lang.toLowerCase();
  return normalized === "html" || normalized === "htm" || normalized === "svg";
}

function getFileExtension(lang: string): string {
  const map: Record<string, string> = {
    typescript: "ts",
    ts: "ts",
    tsx: "tsx",
    javascript: "js",
    js: "js",
    jsx: "jsx",
    python: "py",
    py: "py",
    html: "html",
    htm: "html",
    css: "css",
    json: "json",
    bash: "sh",
    sh: "sh",
    sql: "sql",
    markdown: "md",
    md: "md",
    svg: "svg",
    yaml: "yml",
    yml: "yml",
    rust: "rs",
    go: "go",
  };
  return map[lang.toLowerCase()] || "txt";
}

/**
 * Converts LaTeX delimiters \[...\] and \(...\) into $$...$$ and $...$
 * outside fenced code blocks and inline code spans so remark-math renders them reliably.
 */
function preprocessMath(markdown: string): string {
  const segments = markdown.split(/(```[\s\S]*?```|`[^`\n]+`)/g);
  return segments
    .map((segment, index) => {
      // Odd indices are code blocks / inline code spans; leave untouched
      if (index % 2 === 1) return segment;
      return segment
        .replace(/\\\[([\s\S]*?)\\\]/g, (_match, expr: string) => `\n$$\n${expr.trim()}\n$$\n`)
        .replace(/\\\(([\s\S]*?)\\\)/g, (_match, expr: string) => `$${expr.trim()}$`);
    })
    .join("");
}

interface CodeBlockProps {
  language: string;
  code: string;
  onOpenCanvas?: (artifact: CanvasArtifact, initialTab?: "code" | "preview") => void;
}

const CodeBlock: React.FC<CodeBlockProps> = ({ language, code, onOpenCanvas }) => {
  const [copied, setCopied] = useState(false);
  const lang = language || "text";
  const lineCount = code.split("\n").length;
  const previewable = isPreviewableLanguage(lang);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const handleDownload = () => {
    const ext = getFileExtension(lang);
    const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `goooner-snippet.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleOpen = (tab: "code" | "preview") => {
    if (!onOpenCanvas) return;
    onOpenCanvas(
      {
        id: `${lang}-${code.length}-${code.slice(0, 24)}`,
        title: previewable ? `Preview (${lang.toUpperCase()})` : `Snippet.${getFileExtension(lang)}`,
        language: lang,
        code,
      },
      tab
    );
  };

  return (
    <div className="my-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0D131F] overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-3.5 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-100/70 dark:bg-[#111827]">
        <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 font-mono min-w-0">
          <span className="font-medium text-slate-800 dark:text-slate-200 truncate">{lang}</span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums whitespace-nowrap">{lineCount} lines</span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {previewable && onOpenCanvas && (
            <button
              type="button"
              onClick={() => handleOpen("preview")}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Preview</span>
            </button>
          )}
          {onOpenCanvas && (
            <button
              type="button"
              onClick={() => handleOpen("code")}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md text-slate-700 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              title="Open in Canvas"
            >
              <PanelRightOpen className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Canvas</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleDownload}
            className="inline-flex items-center justify-center p-1.5 rounded-md text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            title="Download file"
            aria-label="Download snippet"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            aria-label="Copy code"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      </div>

      <pre className="p-4 overflow-x-auto text-[13px] leading-relaxed font-mono text-slate-800 dark:text-slate-200">
        <code>{code}</code>
      </pre>
    </div>
  );
};

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, onOpenCanvas }) => {
  const processedContent = useMemo(() => preprocessMath(content), [content]);

  return (
    <div className="goooner-prose text-slate-800 dark:text-slate-200 break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { strict: false }]]}
        components={{
          pre({ children }) {
            return <>{children}</>;
          },
          code({ className, children, ...props }) {
            const match = /language-([\w-]+)/.exec(className || "");
            const codeText = String(children).replace(/\n$/, "");
            const isBlock = Boolean(match) || codeText.includes("\n");

            if (isBlock) {
              return (
                <CodeBlock
                  language={match ? match[1] : "text"}
                  code={codeText}
                  onOpenCanvas={onOpenCanvas}
                />
              );
            }

            return (
              <code
                className="px-1.5 py-0.5 mx-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-mono text-[0.85em] border border-slate-200/70 dark:border-slate-700/70"
                {...props}
              >
                {children}
              </code>
            );
          },
          a({ href, children }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 underline underline-offset-2 hover:text-blue-700 dark:hover:text-blue-300"
              >
                {children}
              </a>
            );
          },
        }}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  );
};
