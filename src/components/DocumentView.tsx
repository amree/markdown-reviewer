import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import MarkdownRenderer from "./MarkdownRenderer";
import SelectionPopover from "./SelectionPopover";
import CommentRail from "./CommentRail";
import Properties from "./Properties";
import Resizer from "./Resizer";
import DiffView from "./DiffView";
import { extractFrontmatter } from "../lib/frontmatter";
import { useIsDesktop } from "../lib/use-media-query";
import { globalAnchor } from "../lib/positions";
import { readSelection, type SelectionResult } from "../lib/selection";
import { listVersions, type VersionSummary } from "../lib/api-client";
import type { Comment, FullDoc } from "../types";

interface Props {
  doc: FullDoc;
  onChangeComments: (
    updater: (cs: Comment[]) => Comment[],
  ) => void | Promise<void>;
  sidebarHidden: boolean;
  onToggleSidebar: () => void;
}

const RAIL_KEY = "mdr:railWidth";
const RAIL_VISIBLE_KEY = "mdr:railVisible";
const VIEW_MODE_KEY = "mdr:viewMode";
const RAIL_MIN = 280;
const RAIL_MAX = 800;
const RAIL_DEFAULT = 320;

type ViewMode = "rendered" | "raw" | "diff";

const lastSeenKey = (slug: string) => `mdr:lastSeen:${slug}`;
function readLastSeen(slug: string): number {
  return Number(localStorage.getItem(lastSeenKey(slug))) || 0;
}

function clampRail(n: number): number {
  return Math.max(RAIL_MIN, Math.min(RAIL_MAX, n));
}

export default function DocumentView({
  doc,
  onChangeComments,
  sidebarHidden,
  onToggleSidebar,
}: Props) {
  const comments = doc.comments;
  const renderRef = useRef<HTMLDivElement>(null);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);

  const [railWidth, setRailWidth] = useState<number>(() => {
    const stored = Number(localStorage.getItem(RAIL_KEY));
    return Number.isFinite(stored) && stored > 0 ? clampRail(stored) : RAIL_DEFAULT;
  });
  const isDesktop = useIsDesktop();
  const [railVisible, setRailVisible] = useState<boolean>(() => {
    return localStorage.getItem(RAIL_VISIBLE_KEY) !== "0";
  });
  // On mobile, default the rail to closed so the doc fills the screen.
  useEffect(() => {
    if (!isDesktop) setRailVisible(false);
  }, [isDesktop]);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const v = localStorage.getItem(VIEW_MODE_KEY);
    return v === "raw" || v === "diff" ? v : "rendered";
  });

  const [versions, setVersions] = useState<VersionSummary[]>([]);
  useEffect(() => {
    let cancelled = false;
    listVersions(doc.slug)
      .then((v) => {
        if (!cancelled) setVersions(v);
      })
      .catch(() => {
        // No versions endpoint reachable / no history yet — render falls back.
      });
    return () => {
      cancelled = true;
    };
  }, [doc.slug, doc.updatedAt]);

  const [lastSeen, setLastSeen] = useState<number>(() => readLastSeen(doc.slug));
  useEffect(() => {
    setLastSeen(readLastSeen(doc.slug));
  }, [doc.slug]);

  const latestVersion = versions[versions.length - 1];
  const priorVersionForDiff =
    latestVersion && versions.length >= 2
      ? lastSeen > 0 && lastSeen < latestVersion.version
        ? lastSeen
        : versions[versions.length - 2].version
      : null;
  const hasUnseenClaudeEdit =
    !!latestVersion &&
    versions.length >= 2 &&
    latestVersion.editor === "claude" &&
    latestVersion.version > lastSeen;
  const canDiff = !!priorVersionForDiff;

  const markSeen = useCallback(() => {
    if (!latestVersion) return;
    localStorage.setItem(lastSeenKey(doc.slug), String(latestVersion.version));
    setLastSeen(latestVersion.version);
  }, [doc.slug, latestVersion]);

  // Switching into diff view counts as "I've seen Claude's changes."
  useEffect(() => {
    if (viewMode === "diff" && hasUnseenClaudeEdit) markSeen();
  }, [viewMode, hasUnseenClaudeEdit, markSeen]);

  useEffect(() => {
    localStorage.setItem(RAIL_KEY, String(railWidth));
  }, [railWidth]);
  // Only persist visibility on desktop — see equivalent comment in App.tsx.
  useEffect(() => {
    if (isDesktop) {
      localStorage.setItem(RAIL_VISIBLE_KEY, railVisible ? "1" : "0");
    }
  }, [railVisible, isDesktop]);
  useEffect(() => {
    localStorage.setItem(VIEW_MODE_KEY, viewMode);
  }, [viewMode]);

  const resetRail = useCallback(() => setRailWidth(RAIL_DEFAULT), []);
  const toggleRail = useCallback(() => setRailVisible((v) => !v), []);

  const handleNewComment = useCallback(
    (sel: SelectionResult) => {
      const now = new Date().toISOString();
      const id = nanoid();
      const fresh: Comment = {
        id,
        docId: doc.id,
        anchor: sel.anchor,
        status: "open",
        messages: [],
        createdAt: now,
        updatedAt: now,
      };
      onChangeComments((cs) => [...cs, fresh]);
      setActiveCommentId(id);
      setPendingFocusId(id);
    },
    [doc.id, onChangeComments],
  );

  const handleAddGlobalComment = useCallback(() => {
    const now = new Date().toISOString();
    const id = nanoid();
    const fresh: Comment = {
      id,
      docId: doc.id,
      anchor: globalAnchor(),
      status: "open",
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    onChangeComments((cs) => [...cs, fresh]);
    setActiveCommentId(id);
    setPendingFocusId(id);
    setRailVisible(true);
  }, [doc.id, onChangeComments]);

  const handleSpanClick = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      setActiveCommentId(ids[0]);
      // On mobile, tapping a highlight should open the rail to show the
      // matching thread, since the rail isn't otherwise visible.
      if (!isDesktop) setRailVisible(true);
    },
    [isDesktop],
  );

  const frontmatter = useMemo(() => extractFrontmatter(doc.body), [doc.body]);

  const toggleBoth = useCallback(() => {
    const eitherHidden = sidebarHidden || !railVisible;
    if (eitherHidden) {
      // Reveal whichever is hidden so both are visible.
      if (sidebarHidden) onToggleSidebar();
      setRailVisible(true);
    } else {
      // Both visible — collapse both for focus mode.
      onToggleSidebar();
      setRailVisible(false);
    }
  }, [sidebarHidden, railVisible, onToggleSidebar]);

  return (
    <div className="flex-1 flex min-w-0">
      <section className="flex-1 min-w-0 flex flex-col relative">
        <Toolbar
          sidebarHidden={sidebarHidden}
          railHidden={!railVisible}
          viewMode={viewMode}
          onToggleSidebar={onToggleSidebar}
          onToggleRail={toggleRail}
          onToggleBoth={toggleBoth}
          onSetViewMode={setViewMode}
          onAddGlobalComment={handleAddGlobalComment}
          title={doc.title}
          showDiffPill={hasUnseenClaudeEdit && canDiff}
          diffEnabled={canDiff}
          onPillClick={() => {
            setViewMode("diff");
          }}
          onDismissPill={markSeen}
        />
        <div className="flex-1 min-h-0 overflow-y-auto mdr-paper-bg">
          <div
            className={`mx-auto px-2 py-3 md:px-6 md:py-8 transition-[max-width] duration-200 ${paperMaxWidth(sidebarHidden, !railVisible)}`}
          >
            <div
              className="bg-white md:rounded-xl md:shadow-sm md:ring-1 md:ring-stone-200/70 px-4 py-5 md:px-10 md:py-10"
              ref={renderRef}
            >
              {viewMode === "rendered" && (
                <>
                  {frontmatter && <Properties frontmatter={frontmatter} />}
                  <MarkdownRenderer
                    source={doc.body}
                    comments={comments}
                    activeCommentId={activeCommentId}
                    onSpanClick={handleSpanClick}
                  />
                </>
              )}
              {viewMode === "raw" && <RawView source={doc.body} />}
              {viewMode === "diff" &&
                (priorVersionForDiff && latestVersion ? (
                  <DiffView
                    slug={doc.slug}
                    fromVersion={priorVersionForDiff}
                    toBody={doc.body}
                    toVersion={latestVersion.version}
                  />
                ) : (
                  <div className="text-sm text-stone-500">
                    Nothing to compare yet — only one version on record.
                  </div>
                ))}
            </div>
          </div>
        </div>

        {viewMode === "rendered" && isDesktop && (
          <SelectionPopover
            containerRef={renderRef}
            source={doc.body}
            onComment={handleNewComment}
          />
        )}
        {viewMode === "rendered" && !isDesktop && (
          <MobileSelectionBar
            containerRef={renderRef}
            source={doc.body}
            onComment={handleNewComment}
          />
        )}
      </section>

      {isDesktop && railVisible && (
        <Resizer
          side="right"
          width={railWidth}
          min={RAIL_MIN}
          max={RAIL_MAX}
          onResize={setRailWidth}
          onReset={resetRail}
        />
      )}
      <CommentRail
        doc={doc}
        comments={comments}
        activeCommentId={activeCommentId}
        pendingFocusId={pendingFocusId}
        onClearPendingFocus={() => setPendingFocusId(null)}
        onActivate={setActiveCommentId}
        onChangeComments={onChangeComments}
        width={railWidth}
        visible={railVisible}
        isDesktop={isDesktop}
        onClose={() => setRailVisible(false)}
      />
      {!isDesktop && railVisible && (
        <button
          type="button"
          onClick={() => setRailVisible(false)}
          className="fixed inset-0 z-30 bg-stone-900/40"
          aria-label="Close comments"
        />
      )}
    </div>
  );
}

function MobileSelectionBar({
  containerRef,
  source,
  onComment,
}: {
  containerRef: React.RefObject<HTMLElement>;
  source: string;
  onComment: (sel: SelectionResult) => void;
}) {
  const [sel, setSel] = useState<SelectionResult | null>(null);

  useEffect(() => {
    const handler = () => {
      const container = containerRef.current;
      if (!container) {
        setSel(null);
        return;
      }
      // Defer slightly so iOS's selection UI settles first.
      setTimeout(() => {
        setSel(readSelection(container, source));
      }, 50);
    };
    document.addEventListener("selectionchange", handler);
    return () => document.removeEventListener("selectionchange", handler);
  }, [containerRef, source]);

  if (!sel) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 bg-stone-900 text-white px-4 py-3 flex items-center gap-3 shadow-2xl pb-[max(env(safe-area-inset-bottom),0.75rem)]">
      <div className="flex-1 min-w-0 text-xs opacity-80 truncate">
        “{sel.anchor.snippet}”
      </div>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          onComment(sel);
          window.getSelection()?.removeAllRanges();
          setSel(null);
        }}
        className="shrink-0 rounded-md bg-amber-500 text-white text-sm font-semibold px-4 py-2 active:bg-amber-600"
      >
        Comment
      </button>
    </div>
  );
}

interface ToolbarProps {
  sidebarHidden: boolean;
  railHidden: boolean;
  viewMode: ViewMode;
  onToggleSidebar: () => void;
  onToggleRail: () => void;
  onToggleBoth: () => void;
  onSetViewMode: (m: ViewMode) => void;
  onAddGlobalComment: () => void;
  title: string;
  showDiffPill: boolean;
  diffEnabled: boolean;
  onPillClick: () => void;
  onDismissPill: () => void;
}

function Toolbar({
  sidebarHidden,
  railHidden,
  viewMode,
  onToggleSidebar,
  onToggleRail,
  onToggleBoth,
  onSetViewMode,
  onAddGlobalComment,
  title,
  showDiffPill,
  diffEnabled,
  onPillClick,
  onDismissPill,
}: ToolbarProps) {
  const bothHidden = sidebarHidden && railHidden;
  return (
    <header className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-stone-200 bg-white/70 backdrop-blur sticky top-0 z-10">
      <IconBtn
        title={sidebarHidden ? "Show document list" : "Hide document list"}
        onClick={onToggleSidebar}
      >
        {sidebarHidden ? "›" : "‹"}
        <span className="sr-only">Toggle sidebar</span>
      </IconBtn>

      <IconBtn
        title={
          bothHidden
            ? "Show both panels"
            : "Hide both panels (focus mode)"
        }
        onClick={onToggleBoth}
      >
        <FocusModeIcon active={bothHidden} />
        <span className="sr-only">Toggle both panels</span>
      </IconBtn>

      <div className="flex-1 min-w-0 px-2">
        <div className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold flex items-center gap-1.5">
          <span>Markdown Reviewer</span>
          <span aria-hidden="true">·</span>
          <a
            href={`https://github.com/amree/markdown-reviewer/commit/${__MDR_VERSION__}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono normal-case tracking-normal text-stone-400 hover:text-stone-700"
            title="View this build on GitHub"
          >
            {__MDR_VERSION__}
          </a>
        </div>
        <div className="text-sm font-semibold text-stone-900 truncate">
          {title}
        </div>
      </div>

      {showDiffPill && (
        <div className="inline-flex items-center gap-0.5 rounded-full border border-amber-300 bg-amber-50 text-amber-900 text-xs">
          <button
            type="button"
            onClick={onPillClick}
            className="pl-2.5 pr-1.5 py-1 font-medium hover:text-amber-700"
            title="Claude edited this since you last looked — view the diff"
          >
            Claude edited — view changes
          </button>
          <button
            type="button"
            onClick={onDismissPill}
            className="pr-2 pl-1 py-1 text-amber-700 hover:text-amber-900"
            aria-label="Mark as seen"
            title="Mark as seen"
          >
            ✕
          </button>
        </div>
      )}

      <div className="inline-flex rounded-md border border-stone-300 text-xs overflow-hidden">
        {(["rendered", "raw", "diff"] as const).map((m) => {
          const disabled = m === "diff" && !diffEnabled;
          return (
            <button
              key={m}
              type="button"
              disabled={disabled}
              onClick={() => onSetViewMode(m)}
              className={
                "px-2.5 py-1 " +
                (m === viewMode
                  ? "bg-stone-900 text-white"
                  : disabled
                    ? "bg-white text-stone-300 cursor-not-allowed"
                    : "bg-white text-stone-600 hover:bg-stone-100")
              }
              title={
                m === "diff" && !diffEnabled
                  ? "Need at least two versions to diff"
                  : undefined
              }
            >
              {m === "rendered" ? "Rendered" : m === "raw" ? "Raw" : "Diff"}
            </button>
          );
        })}
      </div>

      <IconBtn
        title="Add doc-level comment"
        onClick={onAddGlobalComment}
      >
        <DocCommentIcon />
        <span className="sr-only">Add doc-level comment</span>
      </IconBtn>

      <IconBtn
        title={railHidden ? "Show comments" : "Hide comments"}
        onClick={onToggleRail}
      >
        {railHidden ? "‹" : "›"}
        <span className="sr-only">Toggle comments</span>
      </IconBtn>
    </header>
  );
}

function DocCommentIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
      <path d="M5 6h6" />
      <path d="M5 9h4" />
    </svg>
  );
}

function FocusModeIcon({ active }: { active: boolean }) {
  // Two square brackets pointing inward when off (will collapse panels);
  // pointing outward when on (will expand panels back).
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {active ? (
        <>
          <path d="M2 5V2h3" />
          <path d="M14 5V2h-3" />
          <path d="M2 11v3h3" />
          <path d="M14 11v3h-3" />
        </>
      ) : (
        <>
          <path d="M5 2H2v3" />
          <path d="M11 2h3v3" />
          <path d="M5 14H2v-3" />
          <path d="M11 14h3v-3" />
        </>
      )}
    </svg>
  );
}

function IconBtn({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="shrink-0 inline-flex items-center justify-center w-10 h-10 md:w-7 md:h-7 rounded-md text-stone-600 hover:bg-stone-100 hover:text-stone-900 text-lg md:text-base leading-none"
    >
      {children}
    </button>
  );
}

// Widen the paper as side panels collapse so focus mode actually feels
// roomier, but cap it short of edge-to-edge to keep prose readable
// (~95 chars/line at 16px).
function paperMaxWidth(sidebarHidden: boolean, railHidden: boolean): string {
  const hidden = (sidebarHidden ? 1 : 0) + (railHidden ? 1 : 0);
  if (hidden === 0) return "max-w-3xl";
  if (hidden === 1) return "max-w-4xl";
  return "max-w-5xl";
}

function RawView({ source }: { source: string }) {
  return (
    <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-relaxed text-stone-800 bg-stone-50 border border-stone-200 rounded-md p-4">
      {source}
    </pre>
  );
}
