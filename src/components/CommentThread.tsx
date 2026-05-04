import { useEffect, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { formatDistanceToNow } from "date-fns";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { mdComponents } from "../lib/md-components";
import { isGlobalAnchor } from "../lib/positions";
import type {
  Author,
  Comment,
  CommentStatus,
  FullDoc,
  Message,
} from "../types";

function canEditMessage(
  message: Message,
  all: Message[],
  status: CommentStatus,
): boolean {
  if (message.author !== "Me") return false;
  if (status === "resolved" || status === "applied") return false;
  const idx = all.findIndex((m) => m.id === message.id);
  if (idx === -1) return false;
  return all.slice(idx + 1).every((m) => m.author !== "Claude");
}

const collapsedKey = (slug: string) => `mdr:collapsed:${slug}`;

function loadCollapsedMap(slug: string): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(collapsedKey(slug)) || "{}");
  } catch {
    return {};
  }
}

function persistCollapsed(slug: string, commentId: string, value: boolean) {
  const map = loadCollapsedMap(slug);
  map[commentId] = value;
  localStorage.setItem(collapsedKey(slug), JSON.stringify(map));
}

interface Props {
  doc: FullDoc;
  comment: Comment;
  isActive: boolean;
  autoFocus: boolean;
  onActivate: () => void;
  onClearAutoFocus: () => void;
  onChange: (updater: (c: Comment) => Comment) => void;
  onDelete: () => void;
}

export default function CommentThread({
  doc,
  comment,
  isActive,
  autoFocus,
  onActivate,
  onClearAutoFocus,
  onChange,
  onDelete,
}: Props) {
  const [draft, setDraft] = useState("");
  const defaultCollapsed =
    comment.status === "resolved" || comment.status === "applied";
  const [collapsed, setCollapsedRaw] = useState<boolean>(() => {
    const map = loadCollapsedMap(doc.slug);
    return comment.id in map ? map[comment.id] : defaultCollapsed;
  });
  const setCollapsed = (next: boolean | ((prev: boolean) => boolean)) => {
    setCollapsedRaw((prev) => {
      const value = typeof next === "function" ? next(prev) : next;
      persistCollapsed(doc.slug, comment.id, value);
      return value;
    });
  };
  const [editingId, setEditingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const saveEdit = (messageId: string, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      setEditingId(null);
      return;
    }
    onChange((c) => ({
      ...c,
      messages: c.messages.map((m) =>
        m.id === messageId ? { ...m, text: trimmed } : m,
      ),
      updatedAt: new Date().toISOString(),
    }));
    setEditingId(null);
  };

  useEffect(() => {
    if (autoFocus) {
      setCollapsed(false);
      inputRef.current?.focus();
      onClearAutoFocus();
    }
  }, [autoFocus, onClearAutoFocus]);

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    onChange((c) => ({
      ...c,
      messages: [
        ...c.messages,
        {
          id: nanoid(),
          author: "Me",
          text,
          createdAt: new Date().toISOString(),
        },
      ],
      updatedAt: new Date().toISOString(),
    }));
    setDraft("");
  };

  const toggleResolved = () => {
    onChange((c) => {
      const wasDone = c.status === "resolved" || c.status === "applied";
      return {
        ...c,
        status: wasDone ? "open" : "resolved",
        updatedAt: new Date().toISOString(),
      };
    });
  };

  const isResolved = comment.status === "resolved";
  const isApplied = comment.status === "applied";
  const isDone = isResolved || isApplied;
  const isOrphan = comment.status === "orphaned";
  const isGlobal = isGlobalAnchor(comment.anchor);

  return (
    <div
      data-thread-id={comment.id}
      onClick={() => {
        onActivate();
        if (collapsed) setCollapsed(false);
      }}
      className={
        "rounded-md border bg-white shadow-sm transition " +
        (isActive
          ? "border-amber-500 ring-2 ring-amber-200"
          : "border-stone-200") +
        (collapsed
          ? " cursor-pointer hover:border-stone-300" +
            (isDone ? " opacity-70 hover:opacity-100" : "")
          : "")
      }
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-stone-100 text-xs text-stone-500">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setCollapsed((v) => !v);
          }}
          className={
            "hover:text-stone-700 inline-flex items-center gap-1 " +
            (isGlobal ? "" : "font-mono")
          }
          title={
            (isGlobal
              ? "Doc-level comment"
              : `${comment.anchor.startLine}/${comment.anchor.startCol}:${comment.anchor.endLine}/${comment.anchor.endCol}`) +
            ` — click to ${collapsed ? "expand" : "collapse"}`
          }
        >
          <ChevronIcon open={!collapsed} />
          {isGlobal ? (
            <span className="inline-flex items-center gap-1 text-stone-600 font-semibold uppercase tracking-wide text-[10px]">
              <GlobeIcon /> Doc-level
            </span>
          ) : (
            <>
              {comment.anchor.startLine}/{comment.anchor.startCol}
              :{comment.anchor.endLine}/{comment.anchor.endCol}
            </>
          )}
        </button>
        <div className="flex items-center gap-2">
          {isOrphan && (
            <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold">
              orphaned
            </span>
          )}
          {isResolved && (
            <span className="px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-semibold">
              resolved
            </span>
          )}
          {isApplied && (
            <span
              className="px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold inline-flex items-center gap-0.5"
              title="Resolved by editing the document — original anchor text is gone"
            >
              ✓ applied
            </span>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              // Empty threads (highlighted but never typed in) are cheap to
              // dismiss — skip the confirm prompt so closing feels like a
              // cancel, not a destructive action.
              if (comment.messages.length === 0) {
                onDelete();
                return;
              }
              if (confirm("Delete this comment thread?")) onDelete();
            }}
            className="text-stone-400 hover:text-red-600"
            aria-label="Delete thread"
          >
            ✕
          </button>
        </div>
      </div>

      {comment.anchor.snippet && (
        <div
          onClick={(e) => {
            e.stopPropagation();
            setCollapsed((v) => !v);
            onActivate();
          }}
          className={
            "px-3 pt-2 text-xs italic cursor-pointer " +
            (collapsed ? "pb-2 " : "") +
            (isOrphan ? "text-red-700" : "text-stone-500") +
            (isApplied ? " line-through opacity-70" : "")
          }
        >
          “{comment.anchor.snippet}”
        </div>
      )}

      {!collapsed && (
        <>
          <div className="px-3 py-2 space-y-2">
            {comment.messages.length === 0 && (
              <div className="text-xs text-stone-400 italic">No messages yet.</div>
            )}
            {comment.messages.map((m) => {
              const editable = canEditMessage(m, comment.messages, comment.status);
              const isEditing = editingId === m.id;
              return (
                <div key={m.id} className="flex gap-2 group/message">
                  <Avatar author={m.author} />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-stone-500 flex items-center gap-1.5">
                      <span className="font-semibold text-stone-700">
                        {m.author}
                      </span>
                      <span>
                        {formatDistanceToNow(new Date(m.createdAt), {
                          addSuffix: true,
                        })}
                      </span>
                      {editable && !isEditing && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingId(m.id);
                          }}
                          aria-label="Edit message"
                          title="Edit message"
                          className="ml-auto inline-flex items-center justify-center w-7 h-7 md:w-5 md:h-5 rounded text-stone-400 hover:text-stone-700 hover:bg-stone-100 opacity-100 md:opacity-0 md:group-hover/message:opacity-100 transition-opacity"
                        >
                          <PencilIcon />
                        </button>
                      )}
                      {!editable &&
                        m.author === "Me" &&
                        comment.status !== "resolved" &&
                        comment.status !== "applied" && (
                          <span
                            className="ml-auto text-stone-400"
                            title="Can't edit — Claude has replied"
                          >
                            <LockIcon />
                          </span>
                        )}
                    </div>
                    {isEditing ? (
                      <EditMessage
                        initial={m.text}
                        onSave={(t) => saveEdit(m.id, t)}
                        onCancel={() => setEditingId(null)}
                      />
                    ) : (
                      <MessageBody text={m.text} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="px-3 pb-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleResolved();
                }}
                className={
                  "ml-auto text-xs rounded-md px-2 py-1 border " +
                  (isDone
                    ? "bg-stone-100 text-stone-700 border-stone-300 hover:bg-stone-200"
                    : "bg-green-50 text-green-700 border-green-200 hover:bg-green-100")
                }
              >
                {isDone ? "Reopen" : "Resolve"}
              </button>
            </div>
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={
                isDone
                  ? "Add a follow-up note…"
                  : "Reply… (⌘↩ to send)"
              }
              rows={2}
              className="w-full resize-y rounded-md border border-stone-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
            />
            <div className="flex justify-end mt-1.5">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  submit();
                }}
                disabled={!draft.trim()}
                className="rounded-md bg-stone-900 text-white text-xs font-medium px-2.5 py-1.5 disabled:opacity-40 hover:bg-stone-800"
              >
                Send
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function EditMessage({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    // Place caret at end and grow textarea to fit content.
    el.setSelectionRange(el.value.length, el.value.length);
    el.style.height = "auto";
    el.style.height = `${Math.min(400, el.scrollHeight)}px`;
  }, []);

  return (
    <div className="mt-1" onClick={(e) => e.stopPropagation()}>
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const el = e.currentTarget;
          el.style.height = "auto";
          el.style.height = `${Math.min(400, el.scrollHeight)}px`;
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            onSave(text);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        rows={2}
        className="w-full resize-y rounded-md border border-amber-400 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
      />
      <div className="flex justify-end gap-1.5 mt-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="text-xs rounded-md px-2 py-1 text-stone-600 hover:bg-stone-100"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onSave(text)}
          disabled={!text.trim() || text === initial}
          className="rounded-md bg-stone-900 text-white text-xs font-medium px-2.5 py-1 disabled:opacity-40 hover:bg-stone-800"
        >
          Save
        </button>
      </div>
    </div>
  );
}

function GlobeIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="11"
      height="11"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="5.5" />
      <path d="M2.5 8h11" />
      <path d="M8 2.5c1.8 2 1.8 9 0 11" />
      <path d="M8 2.5c-1.8 2-1.8 9 0 11" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      width="10"
      height="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={"transition-transform " + (open ? "rotate-90" : "")}
      aria-hidden="true"
    >
      <path d="M4 2.5l3.5 3.5L4 9.5" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11.5 2.5l2 2-8 8H3.5v-2l8-8z" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="11"
      height="11"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
    >
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5 7V5a3 3 0 0 1 6 0v2" />
    </svg>
  );
}

function MessageBody({ text }: { text: string }) {
  return (
    <div
      className={
        // prose-sm scales the markdown styles down for the narrow rail.
        // The override classes tighten vertical spacing so each message
        // stays compact, and shrink code blocks so they don't dominate.
        "mdr-msg prose prose-sm prose-stone max-w-none mt-0.5 " +
        "prose-p:my-1.5 prose-headings:my-2 " +
        "prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 " +
        "prose-pre:my-2 prose-pre:px-2 prose-pre:py-1.5 prose-pre:text-[11px] prose-pre:leading-snug " +
        "prose-code:text-[11px]"
      }
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={mdComponents}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function Avatar({ author }: { author: Author }) {
  const isMe = author === "Me";
  return (
    <div
      className={
        "shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold text-white " +
        (isMe ? "bg-stone-700" : "bg-[#D97757]")
      }
      title={author}
    >
      {isMe ? "M" : "C"}
    </div>
  );
}

