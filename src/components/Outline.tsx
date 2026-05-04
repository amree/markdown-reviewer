import { useEffect, useMemo, useRef, useState } from "react";
import { parseOutline } from "../lib/outline";

interface Props {
  body: string;
  isDesktop: boolean;
  onJump: () => void;
}

// Distance from the viewport top at which a heading counts as "current".
// Sits a hair below the sticky toolbar (~50px) plus the prose
// scroll-margin-top so a freshly clicked heading is immediately active.
const ACTIVE_THRESHOLD_PX = 100;

export default function Outline({ body, isDesktop, onJump }: Props) {
  const items = useMemo(() => parseOutline(body), [body]);
  const [activeStart, setActiveStart] = useState<number | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (items.length === 0) {
      setActiveStart(null);
      return;
    }
    // The doc scroll container — see DocumentView.tsx. If the class ever
    // changes, the live highlight quietly stops working but clicks still do.
    const scroller = document.querySelector<HTMLElement>(".mdr-paper-bg");
    if (!scroller) return;

    let pending = false;
    const update = () => {
      pending = false;
      let active: number | null = null;
      for (const item of items) {
        const el = document.querySelector<HTMLElement>(
          `[data-src-start="${item.srcStart}"]`,
        );
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (top - ACTIVE_THRESHOLD_PX <= 0) active = item.srcStart;
        else break; // headings are in source order, so all later ones are below.
      }
      // Before the first heading crosses the threshold, highlight the first
      // entry so the outline never looks "blank" at the top of the doc.
      setActiveStart(active ?? items[0]?.srcStart ?? null);
    };
    const onScroll = () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(update);
    };
    update();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [items]);

  // Keep the active item visible inside the outline list.
  useEffect(() => {
    if (activeStart == null) return;
    const list = listRef.current;
    if (!list) return;
    const target = list.querySelector<HTMLElement>(
      `[data-active-start="${activeStart}"]`,
    );
    target?.scrollIntoView({ block: "nearest" });
  }, [activeStart]);

  if (items.length === 0) {
    return (
      <div className="flex-1 px-4 py-6 text-sm text-stone-500">
        No headings in this document.
      </div>
    );
  }

  const minLevel = items.reduce((m, i) => Math.min(m, i.level), 6);

  const handleClick = (srcStart: number) => {
    const el = document.querySelector<HTMLElement>(
      `[data-src-start="${srcStart}"]`,
    );
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (!isDesktop) onJump();
  };

  return (
    <ul ref={listRef} className="flex-1 overflow-y-auto py-2 px-1">
      {items.map((item, idx) => {
        const isActive = item.srcStart === activeStart;
        return (
          <li
            key={`${item.srcStart}-${idx}`}
            data-active-start={item.srcStart}
          >
            <button
              type="button"
              onClick={() => handleClick(item.srcStart)}
              style={{ paddingLeft: `${(item.level - minLevel) * 12 + 12}px` }}
              className={
                "w-full text-left py-1 pr-2 rounded-md truncate transition-colors " +
                (item.level === minLevel ? "text-sm font-medium " : "text-[13px] ") +
                (isActive
                  ? "bg-stone-200 text-stone-900"
                  : "text-stone-700 hover:bg-stone-100")
              }
              title={item.text}
            >
              {item.text}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
