import { useEffect, useMemo, useState } from "react";
import { diffLines } from "diff";
import { getVersionBody } from "../lib/api-client";

interface Props {
  slug: string;
  fromVersion: number;
  toBody: string;
  toVersion: number;
}

export default function DiffView({
  slug,
  fromVersion,
  toBody,
  toVersion,
}: Props) {
  const [fromBody, setFromBody] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFromBody(null);
    setError(null);
    getVersionBody(slug, fromVersion)
      .then((b) => {
        if (!cancelled) setFromBody(b);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, fromVersion]);

  const parts = useMemo(() => {
    if (fromBody == null) return null;
    return diffLines(fromBody, toBody);
  }, [fromBody, toBody]);

  if (error) {
    return (
      <div className="text-sm text-red-700">
        Couldn't load version {fromVersion}: {error}
      </div>
    );
  }
  if (!parts) {
    return (
      <div className="text-sm text-stone-500">Loading diff…</div>
    );
  }

  const adds = parts.filter((p) => p.added).reduce((n, p) => n + (p.count ?? 0), 0);
  const dels = parts.filter((p) => p.removed).reduce((n, p) => n + (p.count ?? 0), 0);

  return (
    <div className="space-y-3">
      <div className="text-xs text-stone-500">
        Diff v{fromVersion} → v{toVersion} —{" "}
        <span className="text-green-700">+{adds}</span>{" "}
        <span className="text-red-700">−{dels}</span>
      </div>
      <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-relaxed border border-stone-200 rounded-md bg-stone-50 overflow-hidden">
        {parts.map((part, i) => (
          <DiffBlock key={i} part={part} />
        ))}
      </pre>
    </div>
  );
}

function DiffBlock({
  part,
}: {
  part: { value: string; added?: boolean; removed?: boolean };
}) {
  const lines = part.value.replace(/\n$/, "").split("\n");
  const cls = part.added
    ? "bg-green-50 text-green-900 border-l-2 border-green-400"
    : part.removed
      ? "bg-red-50 text-red-900 border-l-2 border-red-400"
      : "text-stone-600";
  const marker = part.added ? "+" : part.removed ? "−" : " ";
  return (
    <>
      {lines.map((line, j) => (
        <div key={j} className={"px-3 py-0.5 " + cls}>
          <span className="select-none opacity-50 mr-2">{marker}</span>
          {line || " "}
        </div>
      ))}
    </>
  );
}
