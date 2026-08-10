import React from "react";
import { Composition } from "remotion";

import { TextCard, type TextCardProps } from "./TextCard";

// Inlined rather than imported from the shared module: Remotion's bundler does
// not resolve the `@/` alias. These must match src/lib/shared/reel.ts.
const OUTPUT_WIDTH = 1080;
const OUTPUT_HEIGHT = 1920;
const OUTPUT_FPS = 30;

const defaultTextCardProps: TextCardProps = {
  text: "WHO DID IT BETTER?",
  fontSize: 84,
  position: "center",
  align: "center",
  color: "#ffffff",
  background: "#000000",
};

/**
 * Remotion's composition registry.
 *
 * Only text cards are registered: video composition is FFmpeg's job, so
 * Remotion never has to decode video frames. Real prop values arrive per
 * render through `inputProps`; the defaults here just make the composition
 * previewable in the Remotion studio.
 */
export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="TextCard"
      component={TextCard as unknown as React.FC<Record<string, unknown>>}
      durationInFrames={1}
      fps={OUTPUT_FPS}
      width={OUTPUT_WIDTH}
      height={OUTPUT_HEIGHT}
      defaultProps={defaultTextCardProps as unknown as Record<string, unknown>}
    />
  );
};
