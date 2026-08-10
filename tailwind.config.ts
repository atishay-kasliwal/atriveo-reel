import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // A near-black neutral ramp. The UI is dark-first: video is the
        // subject, so the interface stays out of its way.
        ink: {
          950: "#08090a",
          900: "#0e1011",
          800: "#16191b",
          700: "#1f2325",
          600: "#2c3134",
          500: "#40474b",
          400: "#697276",
          300: "#9aa3a7",
          200: "#c8cfd2",
          100: "#e8ecee",
        },
        accent: {
          DEFAULT: "#4f8cff",
          hover: "#6b9dff",
          muted: "#1c2f5c",
        },
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
