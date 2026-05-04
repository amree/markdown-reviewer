import { useMemo } from "react";
import { parseOutline } from "../lib/outline";

interface Props {
  body: string;
  isDesktop: boolean;
  onJump: () => void;
}

export default function Outline({ body, isDesktop, onJump }: Props) {
  const items = useMemo(() => parseOutline(body), [body]);

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
    <ul className="flex-1 overflow-y-auto py-2 px-1">
      {items.map((item, idx) => (
        <li key={`${item.srcStart}-${idx}`}>
          <button
            type="button"
            onClick={() => handleClick(item.srcStart)}
            style={{ paddingLeft: `${(item.level - minLevel) * 12 + 12}px` }}
            className={
              "w-full text-left py-1 pr-2 text-stone-700 hover:bg-stone-100 rounded-md truncate " +
              (item.level === minLevel
                ? "text-sm font-medium"
                : "text-[13px]")
            }
            title={item.text}
          >
            {item.text}
          </button>
        </li>
      ))}
    </ul>
  );
}
