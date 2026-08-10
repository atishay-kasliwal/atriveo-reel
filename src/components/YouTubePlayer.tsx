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

function loadYouTubeApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();

  apiPromise ??= new Promise<void>((resolve) => {
    if (window.YT?.Player) {
      resolve();
      return;
    }

    // YouTube calls this global once the API is ready. Chain onto any
    // existing handler rather than replacing it.
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve();
    };

    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
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

    void loadYouTubeApi().then(() => {
      // The API can fail to load entirely if the script is blocked; without
      // it there is no player to construct.
      if (cancelled || !containerRef.current || !window.YT?.Player) {
        if (!cancelled) setFailed(true);
        return;
      }

      playerRef.current = new window.YT.Player(containerRef.current, {
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
            const states: Record<number, PlayerState> = {
              [-1]: "unstarted",
              0: "ended",
              1: "playing",
              2: "paused",
              3: "buffering",
            };
            onStateChangeRef.current?.(states[event.data] ?? "paused");
          },
          onError: () => setFailed(true),
        },
      });
    });

    return () => {
      cancelled = true;
      playerRef.current?.destroy();
      playerRef.current = null;
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
