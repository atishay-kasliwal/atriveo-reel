import React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";

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
  /**
   * The caption band's strip in output pixels, when the reel has one. A zero
   * `bandHeight` means no band, and the card gets the whole frame.
   */
  bandTop: number;
  bandHeight: number;
}

/**
 * A text card, rendered by Remotion to a transparent PNG that FFmpeg overlays
 * onto the video. Remotion handles what drawtext does poorly: web fonts,
 * automatic wrapping, and proper line breaking.
 *
 * The background is intentionally transparent here — the solid colour is laid
 * down by FFmpeg, so one PNG works for any background.
 *
 * When the reel carries a caption band, the card lays its words out in the
 * pane-sized region beside the band rather than across the whole frame: the
 * band stays on screen through the card, and FFmpeg draws it last, so anything
 * written into that strip would simply be covered.
 */
export const TextCard: React.FC<TextCardProps> = ({
  text,
  fontSize,
  position,
  align,
  color,
  bandTop,
  bandHeight,
}) => {
  const { height } = useVideoConfig();

  const justifyContent =
    position === "top" ? "flex-start" : position === "bottom" ? "flex-end" : "center";

  const alignItems =
    align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center";

  /*
   * Which slice of the frame the words get. Without a band it is all of it.
   * With one, a card aimed at the bottom takes the region below the band and
   * everything else takes the region above — the band already occupies the
   * optical centre, so "centre" means centred in the space the band left.
   */
  const region =
    bandHeight > 0
      ? position === "bottom"
        ? { top: bandTop + bandHeight, height: height - bandTop - bandHeight }
        : { top: 0, height: bandTop }
      : { top: 0, height };

  return (
    <AbsoluteFill style={{ backgroundColor: "transparent" }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: region.top,
          height: region.height,
          display: "flex",
          flexDirection: "column",
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
      </div>
    </AbsoluteFill>
  );
};
