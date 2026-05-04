import { useCallback, useEffect, useRef, useState } from "react";
import Sidebar, { type SidebarTab } from "./components/Sidebar";
import DocumentView from "./components/DocumentView";
import PasteModal from "./components/PasteModal";
import ExportModal from "./components/ExportModal";
import Resizer from "./components/Resizer";
import {
  createDoc,
  deleteDoc,
  getDoc,
  listDocs,
  patchDoc,
  putDocMarkdown,
  subscribeDocEvents,
} from "./lib/api-client";
import { useIsDesktop } from "./lib/use-media-query";
import type { Comment, DocSummary, FullDoc } from "./types";

const ACTIVE_KEY = "mdr:activeSlug";
const SIDEBAR_KEY = "mdr:sidebarWidth";
const SIDEBAR_VISIBLE_KEY = "mdr:sidebarVisible";
const SIDEBAR_TAB_KEY = "mdr:sidebarTab";
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 480;
const SIDEBAR_DEFAULT = 256;

function slugFromPath(): string | null {
  const path = window.location.pathname;
  if (path === "/" || path === "") return null;
  // Strip leading slash; ignore anything past a second segment.
  const seg = path.slice(1).split("/")[0];
  return seg ? decodeURIComponent(seg) : null;
}

function pathForSlug(slug: string | null): string {
  return slug ? `/${encodeURIComponent(slug)}` : "/";
}

type ModalState =
  | { kind: "none" }
  | { kind: "paste"; mode: "create" | "replace" }
  | { kind: "export" };

export default function App() {
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [activeSlug, setActiveSlug] = useState<string | null>(
    () => slugFromPath() ?? localStorage.getItem(ACTIVE_KEY),
  );
  const [activeDoc, setActiveDoc] = useState<FullDoc | null>(null);
  const [modal, setModal] = useState<ModalState>({ kind: "none" });
  const [error, setError] = useState<string | null>(null);
  const activeSlugRef = useRef(activeSlug);
  activeSlugRef.current = activeSlug;
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const stored = Number(localStorage.getItem(SIDEBAR_KEY));
    return Number.isFinite(stored) && stored > 0
      ? Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, stored))
      : SIDEBAR_DEFAULT;
  });
  const isDesktop = useIsDesktop();
  // On desktop, persist explicit sidebar visibility. On mobile we default
  // to closed (drawer behaviour) and ignore the persisted desktop value.
  const [sidebarVisible, setSidebarVisible] = useState<boolean>(
    () => localStorage.getItem(SIDEBAR_VISIBLE_KEY) !== "0",
  );
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>(
    () => (localStorage.getItem(SIDEBAR_TAB_KEY) === "outline" ? "outline" : "docs"),
  );
  // When the viewport changes between mobile and desktop, default the
  // drawer to closed on first transition into mobile so it doesn't cover
  // the doc on small screens.
  useEffect(() => {
    if (!isDesktop) setSidebarVisible(false);
  }, [isDesktop]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, String(sidebarWidth));
  }, [sidebarWidth]);
  // Only persist visibility on desktop — on mobile the panel is a transient
  // drawer and we don't want its open/close state to clobber the desktop
  // user-preferred value.
  useEffect(() => {
    if (isDesktop) {
      localStorage.setItem(SIDEBAR_VISIBLE_KEY, sidebarVisible ? "1" : "0");
    }
  }, [sidebarVisible, isDesktop]);
  useEffect(() => {
    localStorage.setItem(SIDEBAR_TAB_KEY, sidebarTab);
  }, [sidebarTab]);

  const refreshDocs = useCallback(async () => {
    try {
      const list = await listDocs();
      setDocs(list);
      return list;
    } catch (e) {
      setError((e as Error).message);
      return [];
    }
  }, []);

  const loadActive = useCallback(async (slug: string | null) => {
    if (slug == null) {
      setActiveDoc(null);
      return;
    }
    try {
      const doc = await getDoc(slug);
      setActiveDoc(doc);
    } catch (e) {
      setError((e as Error).message);
      setActiveDoc(null);
    }
  }, []);

  // Initial load. URL > localStorage > most-recent doc > empty state.
  useEffect(() => {
    (async () => {
      const list = await refreshDocs();
      const fromURL = slugFromPath();
      const stored = localStorage.getItem(ACTIVE_KEY);
      const exists = (s: string | null) =>
        s != null && list.some((d) => d.slug === s);
      const slug =
        (exists(fromURL) ? fromURL : null) ??
        (exists(stored) ? stored : null) ??
        list[0]?.slug ??
        null;
      setActiveSlug(slug);
      if (slug) await loadActive(slug);
      else if (list.length === 0) setModal({ kind: "paste", mode: "create" });
    })();
  }, [refreshDocs, loadActive]);

  // Keep the browser URL in sync with the active slug so the path is
  // shareable and works as a bookmark, and listen for back/forward.
  useEffect(() => {
    const expected = pathForSlug(activeSlug);
    if (window.location.pathname !== expected) {
      window.history.pushState(null, "", expected);
    }
  }, [activeSlug]);

  useEffect(() => {
    const onPop = () => {
      const slug = slugFromPath();
      setActiveSlug(slug);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Persist active slug
  useEffect(() => {
    if (activeSlug == null) localStorage.removeItem(ACTIVE_KEY);
    else localStorage.setItem(ACTIVE_KEY, activeSlug);
  }, [activeSlug]);

  // Refetch active when slug changes
  useEffect(() => {
    if (activeSlug) loadActive(activeSlug);
    else setActiveDoc(null);
  }, [activeSlug, loadActive]);

  // SSE: refresh on any event; refetch active doc if it was touched.
  // If no doc is active and one just arrived (created or updated), auto-focus
  // it so a fresh `mdr push` lands in front of the user immediately.
  useEffect(() => {
    const unsub = subscribeDocEvents((e) => {
      refreshDocs();
      if (e.type === "deleted") {
        if (e.slug === activeSlugRef.current) {
          setActiveDoc(null);
          setActiveSlug(null);
        }
        return;
      }
      if (activeSlugRef.current == null) {
        setActiveSlug(e.slug);
        return;
      }
      if (e.slug === activeSlugRef.current) loadActive(e.slug);
    });
    return unsub;
  }, [refreshDocs, loadActive]);

  const handlePasteCreate = useCallback(async (input: string) => {
    try {
      const summary = await createDoc(input);
      await refreshDocs();
      setActiveSlug(summary.slug);
      setModal({ kind: "none" });
    } catch (e) {
      setError((e as Error).message);
    }
  }, [refreshDocs]);

  const handlePasteReplace = useCallback(
    async (input: string) => {
      if (!activeSlug) return handlePasteCreate(input);
      try {
        await putDocMarkdown(activeSlug, input);
        // SSE will trigger refresh; modal closes immediately.
        setModal({ kind: "none" });
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [activeSlug, handlePasteCreate],
  );

  const handleDeleteDoc = useCallback(
    async (slug: string) => {
      if (!confirm("Delete this document and all its comments?")) return;
      try {
        await deleteDoc(slug);
        // SSE will refresh the list; clear active locally if it was this one.
        if (activeSlug === slug) {
          setActiveSlug(null);
          setActiveDoc(null);
        }
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [activeSlug],
  );

  const updateActiveComments = useCallback(
    async (updater: (cs: Comment[]) => Comment[]) => {
      if (!activeDoc) return;
      const next = updater(activeDoc.comments);
      // Optimistic local update for snappy feel.
      setActiveDoc({ ...activeDoc, comments: next });
      try {
        const updated = await patchDoc(activeDoc.slug, { comments: next });
        setActiveDoc(updated);
      } catch (e) {
        setError((e as Error).message);
        // Rollback by refetching authoritative state.
        loadActive(activeDoc.slug);
      }
    },
    [activeDoc, loadActive],
  );

  // On mobile, selecting a doc or opening a modal should auto-close the
  // drawer so the user lands on the content.
  const handleSelectSlug = useCallback(
    (slug: string) => {
      setActiveSlug(slug);
      if (!isDesktop) setSidebarVisible(false);
    },
    [isDesktop],
  );

  return (
    <div className="flex h-full text-sm relative">
      <Sidebar
        docs={docs}
        activeSlug={activeSlug}
        activeBody={activeDoc?.body ?? null}
        tab={sidebarTab}
        onTabChange={setSidebarTab}
        onSelect={handleSelectSlug}
        onNew={() => setModal({ kind: "paste", mode: "create" })}
        onPasteReplace={() => setModal({ kind: "paste", mode: "replace" })}
        onExport={() => setModal({ kind: "export" })}
        onDelete={handleDeleteDoc}
        width={sidebarWidth}
        visible={sidebarVisible}
        isDesktop={isDesktop}
        onClose={() => setSidebarVisible(false)}
      />
      {isDesktop && sidebarVisible && (
        <Resizer
          side="left"
          width={sidebarWidth}
          min={SIDEBAR_MIN}
          max={SIDEBAR_MAX}
          onResize={setSidebarWidth}
          onReset={() => setSidebarWidth(SIDEBAR_DEFAULT)}
        />
      )}
      {!isDesktop && sidebarVisible && (
        <button
          type="button"
          onClick={() => setSidebarVisible(false)}
          className="fixed inset-0 z-30 bg-stone-900/40"
          aria-label="Close sidebar"
        />
      )}
      <main className="flex-1 min-w-0 flex">
        {activeDoc ? (
          <DocumentView
            doc={activeDoc}
            onChangeComments={updateActiveComments}
            sidebarHidden={!sidebarVisible}
            onToggleSidebar={() => setSidebarVisible((v) => !v)}
          />
        ) : (
          <EmptyState
            onNew={() => setModal({ kind: "paste", mode: "create" })}
            sidebarHidden={!sidebarVisible}
            onToggleSidebar={() => setSidebarVisible((v) => !v)}
          />
        )}
      </main>

      {modal.kind === "paste" && (
        <PasteModal
          mode={modal.mode}
          docTitle={activeDoc?.title}
          onCancel={() => setModal({ kind: "none" })}
          onSubmit={
            modal.mode === "create" ? handlePasteCreate : handlePasteReplace
          }
        />
      )}
      {modal.kind === "export" && activeDoc && (
        <ExportModal
          doc={activeDoc}
          comments={activeDoc.comments}
          onClose={() => setModal({ kind: "none" })}
        />
      )}

      {error && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-red-600 text-white px-4 py-2 rounded-md shadow-lg text-xs flex items-center gap-3">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="opacity-80 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

function EmptyState({
  onNew,
  sidebarHidden,
  onToggleSidebar,
}: {
  onNew: () => void;
  sidebarHidden: boolean;
  onToggleSidebar: () => void;
}) {
  return (
    <div className="flex-1 flex flex-col">
      <header className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-stone-200 bg-white/70">
        <button
          type="button"
          onClick={onToggleSidebar}
          title={sidebarHidden ? "Show document list" : "Hide document list"}
          className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md text-stone-600 hover:bg-stone-100 text-base leading-none"
        >
          {sidebarHidden ? "›" : "‹"}
        </button>
      </header>
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-stone-700">
            No document open
          </h2>
          <p className="mt-1 text-stone-500">
            Paste a markdown plan or push one via{" "}
            <code className="text-xs bg-stone-100 px-1 py-0.5 rounded">
              mdr push
            </code>
            .
          </p>
          <button
            type="button"
            onClick={onNew}
            className="mt-4 inline-flex items-center rounded-md bg-stone-900 px-3 py-1.5 text-white hover:bg-stone-800"
          >
            Paste markdown
          </button>
        </div>
      </div>
    </div>
  );
}
