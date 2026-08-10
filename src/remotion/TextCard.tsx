import React from "react";
import { AbsoluteFill } from "remotion";

/**
 * Props are declared structurally rather than imported from the shared reel
 * types: this module is compiled by Remotion's own webpack bundler, which does
 * not resolve the `@/` path alias used elsewhere in the app.
 */
export interface TextCardProps {
  text: string;
  fontSize: number;
  position: "top" | "center" | "bottom";
  align: "left" | "center" | "right";
  color: string;
  /** Card background. Rendered transparent so FFmpeg composites it. */
  background: string;
}

/**
 * A text card, rendered by Remotion to a transparent PNG that FFmpeg overlays
 * onto the video. Remotion handles what drawtext does poorly: web fonts,
 * automatic wrapping, and proper line breaking.
 *
 * The background is intentionally transparent here — the solid colour is laid
 * down by FFmpeg, so one PNG works for any background.
 */
export const TextCard: React.FC<TextCardProps> = ({
  text,
  fontSize,
  position,
  align,
  color,
}) => {
  const justifyContent =
    position === "top" ? "flex-start" : position === "bottom" ? "flex-end" : "center";

  const alignItems =
    align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center";

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "transparent",
        justifyContent,
        alignItems,
        // Keep text clear of the safe-area edges that platforms crop or
        // overlay with UI chrome.
        padding: "12% 8%",
      }}
    >
      <div
        style={{
          color,
          fontSize,
          fontWeight: 800,
          lineHeight: 1.15,
          textAlign: align,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif',
          letterSpacing: "-0.02em",
          // A soft shadow keeps light text legible over bright video.
          textShadow: "0 4px 24px rgba(0,0,0,0.55)",
          maxWidth: "100%",
          overflowWrap: "break-word",
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};
