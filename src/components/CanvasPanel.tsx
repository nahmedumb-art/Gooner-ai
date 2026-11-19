import React, { useState } from "react";
import { Check, Code2, Copy, Download, Eye, RefreshCw, X } from "lucide-react";
import type { CanvasArtifact } from "../types";

interface CanvasPanelProps {
  artifact: CanvasArtifact;
  activeTab: "code" | "preview";
  onTabChange: (tab: "code" | "preview") => void;
  onClose: () => void;
}

export const CanvasPanel: React.FC<CanvasPanelProps> = ({
  artifact,
  activeTab,
  onTabChange,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);

  const lang = artifact.language.toLowerCase();
  const canPreview = lang === "html" || lang === "htm" || lang === "svg";
  const effectiveTab = canPreview ? activeTab : "code";
  const lines = artifact.code.split("\n");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(artifact.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  const handleDownload = () => {
    const ext = lang || "txt";
    const blob = new Blob([artifact.code], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `goooner-canvas.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const previewDoc =
    lang === "svg"
      ? `<!doctype html><html><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#ffffff;">${artifact.code}</body></html>`
      : artifact.code;

  return (
    <aside
      aria-label="Code and Preview Canvas"
      className="flex flex-col h-full bg-white dark:bg-[#0D131F] border-l border-slate-200 dark:border-slate-800"
    >
      <div className="flex items-center justify-between gap-3 px-4 h-14 border-b border-slate-200 dark:border-slate-800 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
            {artifact.title}
          </h2>
          <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums whitespace-nowrap shrink-0">
            {lines.length} lines
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {canPreview && (
            <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/70">
              <button
                type="button"
                onClick={() => onTabChange("code")}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  effectiveTab === "code"
                    ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                }`}
              >
                <Code2 className="w-3.5 h-3.5" />
                <span>Code</span>
              </button>
              <button
                type="button"
                onClick={() => onTabChange("preview")}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  effectiveTab === "preview"
                    ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Preview</span>
              </button>
            </div>
          )}

          {effectiveTab === "preview" && canPreview && (
            <button
              type="button"
              onClick={() => setPreviewKey((k) => k + 1)}
              className="p-2 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              title="Reload preview"
              aria-label="Reload preview"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}

          <button
            type="button"
            onClick={handleCopy}
            className="p-2 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            title="Copy code"
            aria-label="Copy canvas code"
          >
            {copied ? (
              <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
          </button>

          <button
            type="button"
            onClick={handleDownload}
            className="p-2 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            title="Download file"
            aria-label="Download canvas file"
          >
            <Download className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            title="Close Canvas"
            aria-label="Close Canvas"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {effectiveTab === "preview" && canPreview ? (
          <iframe
            key={previewKey}
            title={artifact.title}
            srcDoc={previewDoc}
            sandbox="allow-scripts"
            className="w-full h-full bg-white border-0"
          />
        ) : (
          <div className="h-full overflow-auto p-4 font-mono text-[13px] leading-6 text-slate-800 dark:text-slate-200">
            <table className="w-full border-collapse">
              <tbody>
                {lines.map((line, index) => (
                  <tr
                    key={index}
                    className="hover:bg-slate-100/80 dark:hover:bg-slate-800/40"
                  >
                    <td className="select-none pr-4 text-right text-slate-400 dark:text-slate-600 tabular-nums align-top w-10">
                      {index + 1}
                    </td>
                    <td className="whitespace-pre font-mono">{line || " "}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </aside>
  );
};
