import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        serif: ["Georgia", "Cambria", "Times New Roman", "serif"],
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"]
      },
      colors: {
        ink: "#1f2523",
        paper: "#fbfaf7",
        rule: "#ddd8ce",
        moss: "#586f5b",
        brick: "#9b4d3b",
        steel: "#496170"
      }
    }
  },
  plugins: []
};

export default config;
