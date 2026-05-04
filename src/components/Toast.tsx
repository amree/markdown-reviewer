import { useEffect } from "react";

interface Props {
  message: string;
  onDismiss: () => void;
  durationMs?: number;
}

export default function Toast({ message, onDismiss, durationMs = 3000 }: Props) {
  useEffect(() => {
    const id = window.setTimeout(onDismiss, durationMs);
    return () => window.clearTimeout(id);
  }, [message, onDismiss, durationMs]);

  return (
    <button
      type="button"
      onClick={onDismiss}
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-stone-900 text-white px-3.5 py-2 rounded-full shadow-lg text-xs flex items-center gap-2.5"
    >
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
      {message}
    </button>
  );
}
