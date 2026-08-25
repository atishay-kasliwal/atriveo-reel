"use client";

import { isStackedLayout, OUTPUT_HEIGHT } from "@/lib/shared/reel";
import type {
  CaptionBandSettings,
  EditorState,
  TextCard,
  TextSlot,
} from "../Editor";

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

/**
 * Band type sizes. Smaller than a card's: the band is a strip a few hundred
 * pixels tall, so a card-sized 84px would wrap the moment a caption ran past
 * a couple of words.
 */
const BAND_SIZE_OPTIONS = [
  { value: 48, label: "Small" },
  { value: 64, label: "Medium" },
  { value: 84, label: "Large" },
];

const POSITION_OPTIONS = [
  { value: "top", label: "Top" },
  { value: "center", label: "Center" },
  { value: "bottom", label: "Bottom" },
] as const;

const BACKGROUND_OPTIONS = [
  { value: "solid", label: "Black" },
  { value: "blur", label: "Blurred video" },
] as const;

const SLOTS: {
  slot: TextSlot;
  label: string;
  hint: string;
  placeholder: string;
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
    hint: "After the first video",
    placeholder: "Or this?",
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
  const updateCard = (slot: TextSlot, patch: Partial<TextCard>) => {
    onChange({
      texts: { ...state.texts, [slot]: { ...state.texts[slot], ...patch } },
    });
  };

  const bandInUse =
    isStackedLayout(state.layout) && state.captionBand.text.trim() !== "";

  return (
    <div className="space-y-4">
      {isStackedLayout(state.layout) && (
        <CaptionBandEditor
          band={state.captionBand}
          onChange={(patch) =>
            onChange({ captionBand: { ...state.captionBand, ...patch } })
          }
        />
      )}

      {state.layout === "sequential" && (
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
          {/*
            The band does not blink off for a card, so a card's words are laid
            out around it. Worth saying here rather than leaving the user to
            wonder why centred text sits high.
          */}
          {bandInUse && (
            <p className="hint mt-0.5">
              The band stays up through a card, so card text sits above it —
              or below, if you position it at the bottom.
            </p>
          )}
        </div>

        {SLOTS.map((entry) => (
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

/**
 * The band between the panes: one caption, on screen for the whole reel.
 *
 * Its height is a real trade rather than a cosmetic one — the pixels come out
 * of the two video panes — so the control reports both sides of it: the band's
 * height and what each pane is left with.
 */
function CaptionBandEditor({
  band,
  onChange,
}: {
  band: CaptionBandSettings;
  onChange: (patch: Partial<CaptionBandSettings>) => void;
}) {
  const hasText = band.text.trim() !== "";
  // Mirrors the renderer's geometry: the band's height is split out of the
  // frame and the rest is halved between the panes.
  const paneHeight = Math.floor((OUTPUT_HEIGHT - band.height) / 2);

  return (
    <div className="surface-inset p-2.5">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-[12px] font-medium text-ink-200">
          Caption band
        </span>
        <span className="text-[11px] text-ink-500">Between the panes</span>
      </div>

      <input
        type="text"
        value={band.text}
        onChange={(event) => onChange({ text: event.target.value })}
        placeholder="Who did it better?"
        maxLength={200}
        className="field"
        aria-label="Caption band text"
      />

      <p className="hint mt-1.5">
        Stays on screen for the whole reel, over both clips.
      </p>

      {hasText && (
        <div className="mt-2.5 space-y-2.5 border-t border-ink-800 pt-2.5">
          <Control label="Size">
            {BAND_SIZE_OPTIONS.map((option) => (
              <Chip
                key={option.value}
                selected={band.size === option.value}
                onClick={() => onChange({ size: option.value })}
              >
                {option.label}
              </Chip>
            ))}
          </Control>

          <label className="block">
            <span className="mb-1 flex items-baseline justify-between text-[11px] text-ink-400">
              Height
              <span className="metric">{band.height}px</span>
            </span>
            <input
              type="range"
              min={80}
              max={480}
              step={20}
              value={band.height}
              onChange={(event) =>
                onChange({ height: Number(event.target.value) })
              }
              className="w-full accent-accent"
              aria-label="Caption band height in pixels"
            />
            <span className="mt-1 block text-[11px] text-ink-500">
              Each video pane gets {paneHeight}px of the {OUTPUT_HEIGHT}px frame.
            </span>
          </label>
        </div>
      )}
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

          <Control label="Backdrop">
            {BACKGROUND_OPTIONS.map((option) => (
              <Chip
                key={option.value}
                selected={card.backgroundStyle === option.value}
                onClick={() => onChange({ backgroundStyle: option.value })}
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
