"use client";

import { ClipPicker } from "../ClipPicker";
import type { EditorState, Selection } from "../Editor";
import type { MediaSource } from "@/lib/shared/types";

export function ClipStep({
  sourceA,
  sourceB,
  clipA,
  clipB,
  onChange,
  onContinue,
}: {
  sourceA: MediaSource;
  sourceB: MediaSource;
  clipA: Selection;
  clipB: Selection;
  onChange: (patch: Partial<EditorState>) => void;
  onContinue: () => void;
}) {
  return (
    <div className="space-y-10">
      <ClipPicker
        label="VIDEO A"
        source={sourceA}
        start={clipA.start}
        end={clipA.end}
        onChange={(clip) => onChange({ clipA: clip })}
      />

      <ClipPicker
        label="VIDEO B"
        source={sourceB}
        start={clipB.start}
        end={clipB.end}
        onChange={(clip) => onChange({ clipB: clip })}
      />

      <button type="button" onClick={onContinue} className="btn-primary w-full">
        Continue
      </button>
    </div>
  );
}
