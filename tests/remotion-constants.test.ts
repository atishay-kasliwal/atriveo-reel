import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { OUTPUT_FPS, OUTPUT_HEIGHT, OUTPUT_WIDTH } from "../src/lib/shared/reel";

/**
 * src/remotion/Root.tsx inlines the output dimensions because Remotion's
 * bundler cannot resolve the `@/` path alias. This guards that duplication:
 * if the shared constants change and the Remotion copy doesn't, text cards
 * would be rendered at the wrong size and silently mis-composite.
 */
test("Remotion's inlined output constants match the shared module", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/remotion/Root.tsx"),
    "utf8",
  );

  const read = (name: string): number => {
    const match = source.match(new RegExp(`const ${name} = (\\d+);`));
    assert.ok(match, `${name} not found in Root.tsx`);
    return Number(match[1]);
  };

  assert.equal(read("OUTPUT_WIDTH"), OUTPUT_WIDTH);
  assert.equal(read("OUTPUT_HEIGHT"), OUTPUT_HEIGHT);
  assert.equal(read("OUTPUT_FPS"), OUTPUT_FPS);
});
