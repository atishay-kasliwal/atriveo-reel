"use client";

import type { EditorState } from "../Editor";

const PAUSE_OPTIONS = [
  { value: 0, label: "None" },
  { value: 0.5, label: "0.5s" },
  { value: 1, label: "1s" },
  { value: 2, label: "2s" },
];

const SIZE_OPTIONS = [
  { value: 64, label: "Small" },
  { value: 84, label: "Medium" },
  { value: 112, label: "Large" },
];

const POSITION_OPTIONS = [
  { value: "top", label: "Top" },
  { value: "center", label: "Center" },
  { value: "bottom", label: "Bottom" },
] as const;

export function CustomizeStep({
  state,
  onChange,
  onContinue,
}: {
  state: EditorState;
  onChange: (patch: Partial<EditorState>) => void;
  onContinue: () => void;
}) {
  const isSequential = state.layout === "sequential";
  const hasText = state.text.trim() !== "";

  return (
    <div className="space-y-9">
      {/* A pause only reads as a beat between clips, which the split
          layouts don't have — both clips are already playing together. */}
      {isSequential && (
        <section>
          <h2 className="mb-3 text-xs font-medium tracking-wide text-ink-400">
            PAUSE BETWEEN CLIPS
          </h2>
          <div className="grid grid-cols-4 gap-2">
            {PAUSE_OPTIONS.map((option) => (
              <Chip
                key={option.value}
                selected={state.pauseDuration === option.value}
                onClick={() => onChange({ pauseDuration: option.value })}
              >
                {option.label}
              </Chip>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-xs font-medium tracking-wide text-ink-400">
          TEXT {isSequential ? "BETWEEN CLIPS" : "AFTER CLIPS"}
        </h2>

        <input
          type="text"
          value={state.text}
          onChange={(event) => onChange({ text: event.target.value })}
          placeholder="WHO DID IT BETTER?"
          maxLength={200}
          className="field"
          aria-label="Optional text"
        />

        {hasText && (
          <div className="mt-4 space-y-4">
            <div>
              <span className="mb-2 block text-[11px] text-ink-500">Size</span>
              <div className="grid grid-cols-3 gap-2">
                {SIZE_OPTIONS.map((option) => (
                  <Chip
                    key={option.value}
                    selected={state.textSize === option.value}
                    onClick={() => onChange({ textSize: option.value })}
                  >
                    {option.label}
                  </Chip>
                ))}
              </div>
            </div>

            <div>
              <span className="mb-2 block text-[11px] text-ink-500">Position</span>
              <div className="grid grid-cols-3 gap-2">
                {POSITION_OPTIONS.map((option) => (
                  <Chip
                    key={option.value}
                    selected={state.textPosition === option.value}
                    onClick={() => onChange({ textPosition: option.value })}
                  >
                    {option.label}
                  </Chip>
                ))}
              </div>
            </div>

            <div>
              <span className="mb-2 block text-[11px] text-ink-500">
                On screen for {state.textDuration.toFixed(1)}s
              </span>
              <input
                type="range"
                min={0.5}
                max={5}
                step={0.5}
                value={state.textDuration}
                onChange={(event) =>
                  onChange({ textDuration: Number(event.target.value) })
                }
                className="w-full accent-[#4f8cff]"
                aria-label="Text duration in seconds"
              />
            </div>
          </div>
        )}
      </section>

      <button type="button" onClick={onContinue} className="btn-primary w-full">
        Continue
      </button>
    </div>
  );
}

function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-xl border px-3 py-2.5 text-sm transition-colors ${
        selected
          ? "border-accent bg-accent/10 text-ink-100"
          : "border-ink-800 bg-ink-900/60 text-ink-400 hover:border-ink-600"
      }`}
    >
      {children}
    </button>
  );
}
