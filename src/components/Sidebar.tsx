import { useState } from "react";
import Outline from "./Outline";
import type { DocSummary } from "../types";

export type SidebarTab = "docs" | "outline";

interface Props {
  docs: DocSummary[];
  activeSlug: string | null;
  activeBody: string | null;
  tab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  onSelect: (slug: string) => void;
  onNew: () => void;
  onPasteReplace: () => void;
  onExport: () => void;
  onDelete: (slug: string) => void;
  onClearAll: () => void;
  onReorder: (slugs: string[]) => void;
  width: number;
  visible: boolean;
  isDesktop: boolean;
  onClose: () => void;
}

export default function Sidebar({
  docs,
  activeSlug,
  activeBody,
  tab,
  onTabChange,
  onSelect,
  onNew,
  onPasteReplace,
  onExport,
  onDelete,
  onClearAll,
  onReorder,
  width,
  visible,
  isDesktop,
  onClose,
}: Props) {
  // Desktop: when invisible, collapse out of the layout entirely.
  if (isDesktop && !visible) return null;

  const desktopStyle = isDesktop ? { width } : undefined;
  const wrapperClass = isDesktop
    ? "shrink-0 border-r border-stone-200 bg-white flex flex-col h-full"
    : `fixed inset-y-0 left-0 z-40 w-[85vw] max-w-sm bg-white border-r border-stone-200 flex flex-col shadow-xl transition-transform duration-200 ${
        visible ? "translate-x-0" : "-translate-x-full"
      }`;

  // Outline only makes sense for an open doc; force back to Docs when none.
  const effectiveTab: SidebarTab = activeSlug == null ? "docs" : tab;

  return (
    <aside className={wrapperClass} style={desktopStyle}>
      <div className="px-4 py-3 border-b border-stone-200 flex items-center justify-between">
        <div>
          <h1 className="font-semibold text-stone-900">Markdown Reviewer</h1>
          <p className="text-xs text-stone-500 mt-0.5">
            Local-only · {docs.length} doc{docs.length === 1 ? "" : "s"}
          </p>
        </div>
        {!isDesktop && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close document list"
            className="w-10 h-10 rounded-md flex items-center justify-center text-stone-500 hover:bg-stone-100 -mr-2"
          >
            ✕
          </button>
        )}
      </div>

      <div
        role="tablist"
        className="px-3 pt-2 flex gap-1 border-b border-stone-200"
      >
        <TabButton
          active={effectiveTab === "docs"}
          onClick={() => onTabChange("docs")}
          label="Docs"
        />
        <TabButton
          active={effectiveTab === "outline"}
          onClick={() => onTabChange("outline")}
          label="Outline"
          disabled={activeSlug == null}
        />
      </div>

      {effectiveTab === "docs" ? (
        <DocsPanel
          docs={docs}
          activeSlug={activeSlug}
          onSelect={onSelect}
          onNew={onNew}
          onPasteReplace={onPasteReplace}
          onExport={onExport}
          onDelete={onDelete}
          onClearAll={onClearAll}
          onReorder={onReorder}
          isDesktop={isDesktop}
        />
      ) : (
        <Outline
          body={activeBody ?? ""}
          isDesktop={isDesktop}
          onJump={onClose}
        />
      )}
    </aside>
  );
}

function TabButton({
  active,
  onClick,
  label,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      disabled={disabled}
      className={
        "px-3 py-1.5 text-xs font-medium rounded-t-md border-b-2 -mb-px transition-colors " +
        (active
          ? "border-stone-900 text-stone-900"
          : "border-transparent text-stone-500 hover:text-stone-800 disabled:hover:text-stone-500 disabled:opacity-40")
      }
    >
      {label}
    </button>
  );
}

interface DocsPanelProps {
  docs: DocSummary[];
  activeSlug: string | null;
  onSelect: (slug: string) => void;
  onNew: () => void;
  onPasteReplace: () => void;
  onExport: () => void;
  onDelete: (slug: string) => void;
  onClearAll: () => void;
  onReorder: (slugs: string[]) => void;
  isDesktop: boolean;
}

type DropPosition = "above" | "below";

function reorderSlugs(
  slugs: string[],
  from: string,
  to: string,
  position: DropPosition,
): string[] {
  if (from === to) return slugs;
  const without = slugs.filter((s) => s !== from);
  const targetIdx = without.indexOf(to);
  if (targetIdx === -1) return slugs;
  const insertAt = position === "above" ? targetIdx : targetIdx + 1;
  without.splice(insertAt, 0, from);
  return without;
}

function DocsPanel({
  docs,
  activeSlug,
  onSelect,
  onNew,
  onPasteReplace,
  onExport,
  onDelete,
  onClearAll,
  onReorder,
  isDesktop,
}: DocsPanelProps) {
  const [draggingSlug, setDraggingSlug] = useState<string | null>(null);
  const [dragOverSlug, setDragOverSlug] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<DropPosition | null>(null);

  const clearDragState = () => {
    setDraggingSlug(null);
    setDragOverSlug(null);
    setDropPosition(null);
  };
  return (
    <>
      <div className="px-3 py-2 flex flex-col gap-1.5 border-b border-stone-200">
        <button
          type="button"
          onClick={onNew}
          className="w-full rounded-md bg-stone-900 px-3 py-2 md:py-1.5 text-white text-left text-sm hover:bg-stone-800"
        >
          + New from paste
        </button>
        <button
          type="button"
          onClick={onPasteReplace}
          disabled={activeSlug == null}
          className="w-full rounded-md border border-stone-300 px-3 py-2 md:py-1.5 text-stone-700 text-left text-sm hover:bg-stone-100 disabled:opacity-40"
        >
          Replace current with paste
        </button>
        <button
          type="button"
          onClick={onExport}
          disabled={activeSlug == null}
          className="w-full rounded-md border border-stone-300 px-3 py-2 md:py-1.5 text-stone-700 text-left text-sm hover:bg-stone-100 disabled:opacity-40"
        >
          Export current
        </button>
      </div>

      <ul className="flex-1 overflow-y-auto py-2">
        {docs.length === 0 && (
          <li className="px-4 py-2 text-sm text-stone-500">
            Nothing yet. Paste a plan above or push one with{" "}
            <code className="text-xs">mdr push file.md</code>.
          </li>
        )}
        {docs.map((d) => {
          const isActive = d.slug === activeSlug;
          const isDragging = draggingSlug === d.slug;
          const showIndicator =
            draggingSlug != null &&
            draggingSlug !== d.slug &&
            dragOverSlug === d.slug;
          const total =
            d.openComments + d.resolvedComments + d.orphanedComments;
          return (
            <li
              key={d.slug}
              className={
                "px-2 relative " +
                (isDragging ? "opacity-40" : "") +
                (isDesktop ? " cursor-grab" : "")
              }
              draggable={isDesktop}
              onDragStart={(e) => {
                if (!isDesktop) return;
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", d.slug);
                setDraggingSlug(d.slug);
              }}
              onDragOver={(e) => {
                if (!isDesktop || draggingSlug == null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                const rect = e.currentTarget.getBoundingClientRect();
                const next: DropPosition =
                  e.clientY < rect.top + rect.height / 2 ? "above" : "below";
                if (dragOverSlug !== d.slug) setDragOverSlug(d.slug);
                if (dropPosition !== next) setDropPosition(next);
              }}
              onDragLeave={(e) => {
                // Only clear when the pointer actually leaves the row, not
                // when it crosses into a child element.
                const next = e.relatedTarget as Node | null;
                if (next && e.currentTarget.contains(next)) return;
                if (dragOverSlug === d.slug) {
                  setDragOverSlug(null);
                  setDropPosition(null);
                }
              }}
              onDrop={(e) => {
                if (!isDesktop) return;
                e.preventDefault();
                const from =
                  draggingSlug ?? e.dataTransfer.getData("text/plain");
                if (from && dropPosition) {
                  const next = reorderSlugs(
                    docs.map((doc) => doc.slug),
                    from,
                    d.slug,
                    dropPosition,
                  );
                  onReorder(next);
                }
                clearDragState();
              }}
              onDragEnd={clearDragState}
            >
              {showIndicator && dropPosition === "above" && (
                <div className="absolute left-2 right-2 top-0 h-0.5 bg-stone-500 rounded-full pointer-events-none" />
              )}
              {showIndicator && dropPosition === "below" && (
                <div className="absolute left-2 right-2 bottom-0 h-0.5 bg-stone-500 rounded-full pointer-events-none" />
              )}
              <div
                className={
                  "group flex items-start gap-1 rounded-md " +
                  (isActive ? "bg-stone-200/70" : "hover:bg-stone-100")
                }
              >
                <a
                  href={`/${encodeURIComponent(d.slug)}`}
                  onClick={(e) => {
                    // Let the browser open in a new tab/window for cmd/ctrl/
                    // shift/middle clicks. Otherwise stay SPA-style.
                    if (
                      e.metaKey ||
                      e.ctrlKey ||
                      e.shiftKey ||
                      e.altKey ||
                      e.button !== 0
                    ) {
                      return;
                    }
                    e.preventDefault();
                    onSelect(d.slug);
                  }}
                  className="flex-1 min-w-0 px-2 py-2 md:py-1.5 text-stone-900 no-underline"
                >
                  <div className="truncate font-medium">
                    {d.title || d.slug || "Untitled"}
                  </div>
                  <div className="text-xs text-stone-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                    <span>
                      {total} comment{total === 1 ? "" : "s"}
                    </span>
                    {d.openComments > 0 && (
                      <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-800 px-1.5 py-0.5 text-[10px] font-semibold">
                        {d.openComments} open
                      </span>
                    )}
                    {d.orphanedComments > 0 && (
                      <span className="inline-flex items-center rounded-full bg-red-100 text-red-700 px-1.5 py-0.5 text-[10px] font-semibold">
                        {d.orphanedComments} orphan
                      </span>
                    )}
                    {d.lastEditor === "claude" && (
                      <span
                        className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[#D97757] text-white text-[8px] font-semibold"
                        title="Last edited by Claude"
                      >
                        C
                      </span>
                    )}
                  </div>
                </a>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onDelete(d.slug);
                  }}
                  className="opacity-0 group-hover:opacity-100 md:opacity-0 md:group-hover:opacity-100 shrink-0 text-stone-400 hover:text-red-600 px-2 py-1"
                  title="Delete"
                  aria-label={`Delete ${d.title}`}
                >
                  ✕
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {docs.length > 0 && (
        <div className="px-3 py-2 border-t border-stone-200">
          <button
            type="button"
            onClick={onClearAll}
            className="w-full rounded-md px-3 py-1.5 text-xs text-stone-500 hover:text-red-600 hover:bg-red-50 transition-colors"
          >
            Clear all docs
          </button>
        </div>
      )}
    </>
  );
}
