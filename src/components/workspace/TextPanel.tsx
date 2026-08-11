"use client";

import type { EditorState, TextCard, TextSlot } from "../Editor";

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

const SLOTS: {
  slot: TextSlot;
  label: string;
  hint: string;
  placeholder: string;
  /** Only meaningful when the reel plays full frame. */
  sequentialOnly?: boolean;
}[] = [
  {
    slot: "intro",
    label: "Intro",
    hint: "Before the first video",
    placeholder: "Watch this",
  },
  {
    slot: "middle",
    label: "Middle",
    hint: "Between the two videos",
    placeholder: "Or this?",
    sequentialOnly: true,
  },
  {
    slot: "outro",
    label: "Outro",
    hint: "After the last video",
    placeholder: "Who did it better?",
  },
];

export function TextPanel({
  state,
  onChange,
}: {
  state: EditorState;
  onChange: (patch: Partial<EditorState>) => void;
}) {
  const isSequential = state.layout === "sequential";

  const updateCard = (slot: TextSlot, patch: Partial<TextCard>) => {
    onChange({
      texts: { ...state.texts, [slot]: { ...state.texts[slot], ...patch } },
    });
  };

  const visibleSlots = SLOTS.filter(
    (entry) => isSequential || !entry.sequentialOnly,
  );

  return (
    <div className="space-y-4">
      {isSequential && (
        <div>
          <p className="section-label mb-1.5">Pause between clips</p>
          <div className="flex gap-1.5">
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
        </div>
      )}

      <div className="space-y-2">
        <div>
          <p className="section-label">Text cards</p>
          <p className="hint mt-0.5">
            Optional. Leave a field empty to skip that card.
          </p>
        </div>

        {visibleSlots.map((entry) => (
          <TextCardEditor
            key={entry.slot}
            label={entry.label}
            hint={entry.hint}
            placeholder={entry.placeholder}
            card={state.texts[entry.slot]}
            onChange={(patch) => updateCard(entry.slot, patch)}
          />
        ))}
      </div>
    </div>
  );
}

function TextCardEditor({
  label,
  hint,
  placeholder,
  card,
  onChange,
}: {
  label: string;
  hint: string;
  placeholder: string;
  card: TextCard;
  onChange: (patch: Partial<TextCard>) => void;
}) {
  const hasText = card.text.trim() !== "";

  return (
    <div className="surface-inset p-2.5">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-[12px] font-medium text-ink-200">{label}</span>
        <span className="text-[11px] text-ink-500">{hint}</span>
      </div>

      <input
        type="text"
        value={card.text}
        onChange={(event) => onChange({ text: event.target.value })}
        placeholder={placeholder}
        maxLength={200}
        className="field"
        aria-label={`${label} text`}
      />

      {/* Styling controls appear only once the card has content. */}
      {hasText && (
        <div className="mt-2.5 space-y-2.5 border-t border-ink-800 pt-2.5">
          <Control label="Size">
            {SIZE_OPTIONS.map((option) => (
              <Chip
                key={option.value}
                selected={card.size === option.value}
                onClick={() => onChange({ size: option.value })}
              >
                {option.label}
              </Chip>
            ))}
          </Control>

          <Control label="Position">
            {POSITION_OPTIONS.map((option) => (
              <Chip
                key={option.value}
                selected={card.position === option.value}
                onClick={() => onChange({ position: option.value })}
              >
                {option.label}
              </Chip>
            ))}
          </Control>

          <label className="block">
            <span className="mb-1 flex items-baseline justify-between text-[11px] text-ink-400">
              Duration
              <span className="metric">{card.duration.toFixed(1)}s</span>
            </span>
            <input
              type="range"
              min={0.5}
              max={5}
              step={0.5}
              value={card.duration}
              onChange={(event) =>
                onChange({ duration: Number(event.target.value) })
              }
              className="w-full accent-accent"
              aria-label={`${label} duration in seconds`}
            />
          </label>
        </div>
      )}
    </div>
  );
}

function Control({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-14 shrink-0 text-[11px] text-ink-400">{label}</span>
      <div className="flex flex-1 gap-1.5">{children}</div>
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
      className={`flex-1 rounded-control border px-2 py-1.5 text-[12px]
                  transition-colors duration-fast ${
                    selected
                      ? "border-accent/70 bg-accent-surface text-ink-100"
                      : "border-ink-700 bg-ink-950/50 text-ink-300 hover:border-ink-600 hover:text-ink-100"
                  }`}
    >
      {children}
    </button>
  );
}
