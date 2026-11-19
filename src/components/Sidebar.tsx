import React, { useMemo, useState } from "react";
import {
  MessageSquare,
  Moon,
  Plus,
  Search,
  SlidersHorizontal,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import type { Conversation } from "../types";
import { BrandMark } from "./BrandMark";

interface SidebarProps {
  conversations: Conversation[];
  activeId: string;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onDelete: (id: string) => void;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  hasCustomPrompt: boolean;
  onOpenSystemPrompt: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

function getGroupLabel(timestamp: number): string {
  const now = new Date();
  const date = new Date(timestamp);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400000;

  if (date.getTime() >= startOfToday) return "Today";
  if (date.getTime() >= startOfYesterday) return "Yesterday";
  return "Previous";
}

export const Sidebar: React.FC<SidebarProps> = ({
  conversations,
  activeId,
  onSelect,
  onNewChat,
  onDelete,
  theme,
  onToggleTheme,
  hasCustomPrompt,
  onOpenSystemPrompt,
  mobileOpen,
  onCloseMobile,
}) => {
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
    if (!q) return sorted;
    return sorted.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.messages.some((m) => m.content.toLowerCase().includes(q))
    );
  }, [conversations, searchQuery]);

  const grouped = useMemo(() => {
    const groups: Record<string, Conversation[]> = {
      Today: [],
      Yesterday: [],
      Previous: [],
    };
    for (const conv of filtered) {
      const label = getGroupLabel(conv.updatedAt);
      groups[label].push(conv);
    }
    return groups;
  }, [filtered]);

  const content = (
    <div className="flex flex-col h-full w-68 bg-slate-50 dark:bg-[#0D121C] border-r border-slate-200 dark:border-slate-800/90">
      <div className="flex items-center justify-between px-4 h-14 border-b border-slate-200 dark:border-slate-800/90 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <BrandMark className="w-6 h-6 shrink-0" />
          <span className="font-display text-base font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0">
            Goooner AI
          </span>
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          className="lg:hidden p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200/60 dark:hover:bg-slate-800 cursor-pointer"
          aria-label="Close sidebar"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-3 space-y-2.5 shrink-0">
        <button
          type="button"
          onClick={() => {
            onNewChat();
            onCloseMobile();
          }}
          className="w-full flex items-center justify-center gap-2 h-10 px-4 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-medium hover:bg-slate-800 dark:hover:bg-white transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          <Plus className="w-4 h-4" />
          <span>New Thread</span>
        </button>

        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter threads..."
            aria-label="Filter threads"
            className="w-full h-9 pl-8.5 pr-3 rounded-lg bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 text-xs text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      <nav aria-label="Conversation history" className="flex-1 overflow-y-auto px-2.5 pb-4 space-y-5">
        {(["Today", "Yesterday", "Previous"] as const).map((groupName) => {
          const items = grouped[groupName];
          if (items.length === 0) return null;
          return (
            <div key={groupName}>
              <div className="px-2 pb-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                {groupName}
              </div>
              <ul className="space-y-0.5">
                {items.map((conv) => {
                  const isActive = conv.id === activeId;
                  return (
                    <li key={conv.id} className="group relative flex items-center">
                      <button
                        type="button"
                        onClick={() => {
                          onSelect(conv.id);
                          onCloseMobile();
                        }}
                        className={`w-full flex items-center gap-2.5 px-2.5 py-2 pr-8 rounded-lg text-left text-[13px] transition-colors cursor-pointer ${
                          isActive
                            ? "bg-slate-200/80 dark:bg-slate-800/90 text-slate-900 dark:text-slate-100 font-medium"
                            : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200"
                        }`}
                      >
                        <MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-70" />
                        <span className="truncate">{conv.title}</span>
                      </button>
                      {conversations.length > 1 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDelete(conv.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 focus:opacity-100 absolute right-1.5 p-1.5 rounded-md text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-slate-200/70 dark:hover:bg-slate-700/70 transition-opacity cursor-pointer"
                          title="Delete thread"
                          aria-label={`Delete ${conv.title}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-slate-500 dark:text-slate-400">
            No matching threads found.
          </div>
        )}
      </nav>

      <div className="p-3 border-t border-slate-200 dark:border-slate-800/90 space-y-1 shrink-0">
        <button
          type="button"
          onClick={onOpenSystemPrompt}
          className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/70 transition-colors cursor-pointer"
        >
          <span className="flex items-center gap-2 whitespace-nowrap">
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Custom Instructions</span>
          </span>
          {hasCustomPrompt && (
            <span className="text-[11px] text-blue-600 dark:text-blue-400">Active</span>
          )}
        </button>

        <button
          type="button"
          onClick={onToggleTheme}
          className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/70 transition-colors cursor-pointer"
        >
          <span className="flex items-center gap-2 whitespace-nowrap">
            {theme === "dark" ? (
              <Sun className="w-3.5 h-3.5" />
            ) : (
              <Moon className="w-3.5 h-3.5" />
            )}
            <span>{theme === "dark" ? "Light Theme" : "Dark Theme"}</span>
          </span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block h-full shrink-0">{content}</aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/50 backdrop-blur-xs"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside className="relative z-10 h-full">{content}</aside>
        </div>
      )}
    </>
  );
};
