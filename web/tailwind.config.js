/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "#0b0f14",
        panel: "#111820",
        hair: "#1e2a36",
        ink: "#e5edf5",
        muted: "#8ba0b3",
        accent: "#38bdf8",
      },
    },
  },
  plugins: [],
};
