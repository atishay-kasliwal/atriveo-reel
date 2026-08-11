import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // A near-black neutral ramp. The UI is dark-first: video is the
        // subject, so the interface stays out of its way.
        //
        // The mid greys are lifted relative to a pure-black scale so text on
        // raised surfaces clears WCAG AA, and the surface steps stay visible
        // on dim laptop panels where a 2-3% difference disappears.
        ink: {
          975: "#050607",
          950: "#08090a",
          900: "#101214",
          850: "#15181a",
          800: "#1b1f22",
          700: "#262b2f",
          600: "#353c41",
          500: "#4c545a",
          400: "#7b858b",
          300: "#a8b1b6",
          200: "#d2d8db",
          100: "#eef1f2",
        },
        accent: {
          DEFAULT: "#4f8cff",
          hover: "#6b9dff",
          muted: "#1c2f5c",
          // A dim wash for selected surfaces that must not glow.
          surface: "#141d31",
        },
      },
      borderRadius: {
        // A 10-14px band, applied consistently across the workspace.
        control: "10px",
        panel: "14px",
      },
      boxShadow: {
        // Elevation only where it means something: the preview and overlays.
        panel: "0 1px 2px rgba(0,0,0,0.4), 0 8px 24px -12px rgba(0,0,0,0.7)",
        stage: "0 24px 64px -24px rgba(0,0,0,0.9)",
      },
      transitionDuration: {
        fast: "140ms",
        base: "180ms",
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Inter",
          "Segoe UI",
          "system-ui",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
