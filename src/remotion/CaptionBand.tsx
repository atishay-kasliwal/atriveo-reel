import React from "react";
import { AbsoluteFill } from "remotion";

/**
 * Props are declared structurally rather than imported from the shared reel
 * types, for the same reason as TextCard: Remotion's bundler does not resolve
 * the `@/` path alias used elsewhere in the app.
 */
export interface CaptionBandProps {
  text: string;
  fontSize: number;
  color: string;
  background: string;
}

/**
 * The persistent caption that sits between the two panes of a stacked reel,
 * rendered once to a PNG that FFmpeg overlays for the whole composition.
 *
 * Unlike TextCard this paints its own background. A text card is composited
 * over video or a colour FFmpeg lays down, so it has to stay transparent; the
 * band occupies a strip that belongs to nothing else, and painting it here
 * means the colour and the words are always measured against each other.
 *
 * The composition is sized to the exact band rectangle at render time, so the
 * component only has to centre its contents in whatever it is given.
 */
export const CaptionBand: React.FC<CaptionBandProps> = ({
  text,
  fontSize,
  color,
  background,
}) => {
  return (
    <AbsoluteFill
      style={{
        backgroundColor: background,
        alignItems: "center",
        justifyContent: "center",
        // Horizontal room only: the band is already sized to its content
        // vertically, and padding there would push the text off-centre.
        padding: "0 6%",
      }}
    >
      <div
        style={{
          color,
          fontSize,
          fontWeight: 800,
          lineHeight: 1.15,
          textAlign: "center",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif',
          letterSpacing: "-0.02em",
          maxWidth: "100%",
          overflowWrap: "break-word",
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};
