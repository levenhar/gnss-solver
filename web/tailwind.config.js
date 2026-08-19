/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "#07090c",
        panel: "#10151b",
        panel2: "#0b0f14",
        hair: "#1c2530",
        hairStrong: "#2b3947",
        ink: "#eef3f8",
        muted: "#8b9bab",
        faint: "#586675",
        accent: "#38bdf8",
        accentInk: "#04131b",
        success: "#34d399",
        warning: "#fbbf24",
        danger: "#f87171",
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"SF Pro Text"',
          "ui-sans-serif",
          "system-ui",
          '"Segoe UI"',
          "sans-serif",
        ],
      },
      boxShadow: {
        elevated: "0 1px 1px rgba(0,0,0,0.3), 0 8px 24px -8px rgba(0,0,0,0.55)",
        floating: "0 2px 4px rgba(0,0,0,0.35), 0 16px 40px -12px rgba(0,0,0,0.65)",
        ring: "0 0 0 1px rgba(56,189,248,0.5)",
      },
      backdropBlur: { xs: "2px" },
      keyframes: {
        shimmer: { "100%": { transform: "translateX(100%)" } },
      },
      animation: {
        shimmer: "shimmer 1.6s infinite",
      },
    },
  },
  plugins: [],
};
