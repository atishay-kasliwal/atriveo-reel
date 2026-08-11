"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

export interface PlayerHandle {
  play: () => void;
  pause: () => void;
  seekTo: (seconds: number) => void;
  getCurrentTime: () => number;
}

type PlayerState = "playing" | "paused" | "ended" | "buffering" | "unstarted";

/**
 * Wraps the YouTube IFrame Player API.
 *
 * Used so the user can scrub a YouTube source before it has been downloaded:
 * the actual file is only fetched when a render starts, which keeps the
 * editor instant and avoids downloading videos that get discarded.
 *
 * The API script is loaded once per page and shared between both players.
 */

let apiPromise: Promise<void> | null = null;

/**
 * Resolves once `YT.Player` is actually constructible.
 *
 * `iframe_api` is only a bootstrap: it defines `window.YT` as `{loading, loaded}`
 * straight away and then loads the real widget script asynchronously. So
 * `window.YT` being truthy proves nothing — only `YT.Player` does. The
 * `onYouTubeIframeAPIReady` callback also fires just once per page, and is
 * missed entirely by anything that starts listening after the API has landed,
 * so we poll for the constructor instead of relying solely on it.
 */
function loadYouTubeApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.YT?.Player) return Promise.resolve();

  apiPromise ??= new Promise<void>((resolve, reject) => {
    const started = Date.now();

    const poll = window.setInterval(() => {
      if (window.YT?.Player) {
        window.clearInterval(poll);
        resolve();
        return;
      }
      // Blocked script, offline, or an extension eating the request. Fail so
      // the caller can show the fallback rather than spinning forever.
      if (Date.now() - started > 15_000) {
        window.clearInterval(poll);
        // Allow a later mount to retry from scratch.
        apiPromise = null;
        reject(new Error("YouTube IFrame API did not become ready"));
      }
    }, 100);

    // Chain onto any existing handler rather than replacing it.
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT?.Player) {
        window.clearInterval(poll);
        resolve();
      }
    };

    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => {
        window.clearInterval(poll);
        apiPromise = null;
        reject(new Error("Failed to load the YouTube IFrame API"));
      };
      document.head.appendChild(script);
    }
  });

  return apiPromise;
}

export const YouTubePlayer = forwardRef<
  PlayerHandle,
  {
    videoId: string;
    onReady?: (duration: number) => void;
    onStateChange?: (state: PlayerState) => void;
  }
>(function YouTubePlayer({ videoId, onReady, onStateChange }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const [failed, setFailed] = useState(false);

  // Keep callbacks in refs so re-renders don't tear down the player.
  const onReadyRef = useRef(onReady);
  const onStateChangeRef = useRef(onStateChange);
  useEffect(() => {
    onReadyRef.current = onReady;
    onStateChangeRef.current = onStateChange;
  });

  useImperativeHandle(ref, () => ({
    play: () => playerRef.current?.playVideo(),
    pause: () => playerRef.current?.pauseVideo(),
    seekTo: (seconds) => playerRef.current?.seekTo(seconds, true),
    getCurrentTime: () => playerRef.current?.getCurrentTime() ?? 0,
  }));

  useEffect(() => {
    let cancelled = false;
    // A previous videoId may have failed; give this one a clean slate.
    setFailed(false);
    // YouTube replaces the element it is handed with an <iframe>. Handing it a
    // node React rendered would leave React with a stale child reference and a
    // NotFoundError from removeChild on unmount, which surfaces as a
    // client-side exception. So we mount into a detached node that React never
    // tracks and remove it ourselves during cleanup.
    const host = document.createElement("div");
    host.className = "h-full w-full";
    containerRef.current?.appendChild(host);

    void loadYouTubeApi().then(
      () => {
        if (cancelled || !host.isConnected || !window.YT?.Player) {
          if (!cancelled) setFailed(true);
          return;
        }

        playerRef.current = new window.YT.Player(host, {
          videoId,
          playerVars: {
            // Hide as much YouTube chrome as the embed allows; the app supplies
            // its own transport controls.
            controls: 0,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
            disablekb: 1,
          },
          events: {
            onReady: (event) => {
              if (!cancelled) onReadyRef.current?.(event.target.getDuration());
            },
            onStateChange: (event) => {
              if (cancelled) return;
              const states: Record<number, PlayerState> = {
                [-1]: "unstarted",
                0: "ended",
                1: "playing",
                2: "paused",
                3: "buffering",
              };
              onStateChangeRef.current?.(states[event.data] ?? "paused");
            },
            onError: () => {
              if (!cancelled) setFailed(true);
            },
          },
        });
      },
      // The API never became ready (blocked script, offline, extension).
      () => {
        if (!cancelled) setFailed(true);
      },
    );

    return () => {
      cancelled = true;

      // Tear the player down before detaching, so YouTube's own listeners and
      // timers stop. Teardown races the DOM in ways we don't control, and a
      // failure here must never propagate into React's unmount path.
      try {
        playerRef.current?.destroy();
      } catch {
        // Ignored: the node is being discarded regardless.
      }
      playerRef.current = null;

      // Remove whatever YouTube left behind. This is our own node, so React's
      // subsequent unmount of containerRef is unaffected either way.
      host.remove();
    };
  }, [videoId]);

  if (failed) {
    return (
      <div className="flex aspect-video w-full items-center justify-center bg-ink-900 px-6 text-center">
        <p className="text-sm text-ink-400">
          This video can't be previewed here. You can still set timestamps below.
        </p>
      </div>
    );
  }

  return (
    <div className="aspect-video w-full">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
});

/* ---- Minimal typings for the parts of the IFrame API we use ---- */

interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  destroy(): void;
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement,
        options: {
          videoId: string;
          playerVars?: Record<string, number>;
          events?: {
            onReady?: (event: { target: YTPlayer }) => void;
            onStateChange?: (event: { data: number }) => void;
            onError?: (event: { data: number }) => void;
          };
        },
      ) => YTPlayer;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}
