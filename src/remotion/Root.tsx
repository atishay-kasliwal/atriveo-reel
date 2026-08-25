import React from "react";
import { Composition } from "remotion";

import { CaptionBand, type CaptionBandProps } from "./CaptionBand";
import { TextCard, type TextCardProps } from "./TextCard";

// Inlined rather than imported from the shared module: Remotion's bundler does
// not resolve the `@/` alias. These must match src/lib/shared/reel.ts.
const OUTPUT_WIDTH = 1080;
const OUTPUT_HEIGHT = 1920;
const OUTPUT_FPS = 30;

/**
 * The band's default height in the studio. Real renders override the
 * composition's height with the exact gap left between the panes.
 */
const CAPTION_BAND_HEIGHT = 220;

const defaultTextCardProps: TextCardProps = {
  text: "WHO DID IT BETTER?",
  fontSize: 84,
  position: "center",
  align: "center",
  color: "#ffffff",
  background: "#000000",
  // No band by default: a card is free to use the whole frame.
  bandTop: 0,
  bandHeight: 0,
};

const defaultCaptionBandProps: CaptionBandProps = {
  text: "WHO DID IT BETTER?",
  fontSize: 64,
  color: "#ffffff",
  background: "#000000",
};

/**
 * Remotion's composition registry.
 *
 * Only text is registered: video composition is FFmpeg's job, so Remotion
 * never has to decode video frames. Real prop values arrive per render through
 * `inputProps`; the defaults here just make the compositions previewable in
 * the Remotion studio.
 */
export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="TextCard"
        component={TextCard as unknown as React.FC<Record<string, unknown>>}
        durationInFrames={1}
        fps={OUTPUT_FPS}
        width={OUTPUT_WIDTH}
        height={OUTPUT_HEIGHT}
        defaultProps={defaultTextCardProps as unknown as Record<string, unknown>}
      />

      {/*
        A strip rather than a full frame: the band is overlaid onto the gap
        between the panes, so it is rendered at exactly that size.
      */}
      <Composition
        id="CaptionBand"
        component={CaptionBand as unknown as React.FC<Record<string, unknown>>}
        durationInFrames={1}
        fps={OUTPUT_FPS}
        width={OUTPUT_WIDTH}
        height={CAPTION_BAND_HEIGHT}
        defaultProps={
          defaultCaptionBandProps as unknown as Record<string, unknown>
        }
      />
    </>
  );
};
