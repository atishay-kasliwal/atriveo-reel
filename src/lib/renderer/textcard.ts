import path from "node:path";

import type { Format, TextElement } from "../shared/reel";

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
