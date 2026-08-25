import path from "node:path";

import type { CaptionBand, Format, TextElement } from "../shared/reel";

/**
 * Renders a text card to a transparent PNG using Remotion.
 *
 * Remotion is imported lazily and the bundle is cached for the process
 * lifetime: bundling spins up a bundler and takes seconds, so doing it per
 * card would dominate render time. Callers treat failure as non-fatal and
 * fall back to FFmpeg drawtext.
 */

let bundlePromise: Promise<string> | null = null;

async function getBundle(): Promise<string> {
  bundlePromise ??= (async () => {
    const { bundle } = await import("@remotion/bundler");
    return bundle({
      entryPoint: path.join(process.cwd(), "src/remotion/index.ts"),
      // Keep the bundle out of the data directory so cleanup never removes it.
      outDir: path.join(process.cwd(), ".remotion", "bundle"),
      webpackOverride: (webpackConfig) => webpackConfig,
    });
  })();

  try {
    return await bundlePromise;
  } catch (error) {
    // Don't cache a failed bundle; a later attempt may succeed.
    bundlePromise = null;
    throw error;
  }
}

export async function renderTextCard(
  element: TextElement,
  format: Format,
  outputPath: string,
  /**
   * The caption band's strip, when the reel has one, so the card can lay its
   * words out beside the band instead of underneath it.
   */
  band: { y: number; height: number } | null = null,
): Promise<void> {
  const { selectComposition, renderStill } = await import("@remotion/renderer");
  const serveUrl = await getBundle();

  const inputProps = {
    text: element.text,
    fontSize: element.fontSize,
    position: element.position,
    align: element.align,
    color: element.color,
    background: element.background,
    bandTop: band?.y ?? 0,
    bandHeight: band?.height ?? 0,
  };

  const composition = await selectComposition({
    serveUrl,
    id: "TextCard",
    inputProps,
  });

  await renderStill({
    composition: {
      ...composition,
      width: format.width,
      height: format.height,
    },
    serveUrl,
    output: outputPath,
    inputProps,
    // Transparency is the whole point: FFmpeg supplies the background.
    imageFormat: "png",
  });
}

/**
 * Renders the persistent caption band to a PNG strip.
 *
 * Sized to the exact gap left between the panes rather than the full frame:
 * the band is overlaid at a fixed offset, so rendering it any larger would
 * mean scaling artwork that was laid out for a different box. Opaque, unlike a
 * text card — the band paints its own background.
 */
export async function renderCaptionBand(
  band: CaptionBand,
  rect: { width: number; height: number },
  outputPath: string,
): Promise<void> {
  const { selectComposition, renderStill } = await import("@remotion/renderer");
  const serveUrl = await getBundle();

  const inputProps = {
    text: band.text,
    fontSize: band.fontSize,
    color: band.color,
    background: band.background,
  };

  const composition = await selectComposition({
    serveUrl,
    id: "CaptionBand",
    inputProps,
  });

  await renderStill({
    composition: {
      ...composition,
      width: rect.width,
      height: rect.height,
    },
    serveUrl,
    output: outputPath,
    inputProps,
    imageFormat: "png",
  });
}

/** Warms the bundle so the first render doesn't pay the bundling cost. */
export async function warmTextCardBundle(): Promise<boolean> {
  try {
    await getBundle();
    return true;
  } catch (error) {
    console.warn(`[textcard] Remotion bundle unavailable: ${(error as Error).message}`);
    return false;
  }
}
