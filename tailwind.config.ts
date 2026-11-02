import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: "#16803D", hover: "#146C35", active: "#115C2E", light: "#DCFCE7", foreground: "#FFFFFF" },
        background: { DEFAULT: "#F8FAFC", subtle: "#F1F5F9" },
        surface: "#FFFFFF",
        "text-primary": "#171A21",
        "text-secondary": "#64748B",
        border: "#E5E7EB",
        "border-strong": "#CBD5E1",
        success: "#16A34A",
        warning: "#F59E0B",
        error: "#EF4444",
        info: "#3B82F6"
      },
      fontFamily: { sans: ["Inter", "system-ui", "-apple-system", "sans-serif"] },
      borderRadius: { button: "12px", card: "14px" },
      boxShadow: { soft: "0 4px 12px rgba(0,0,0,.06)" }
    }
  },
  plugins: []
} satisfies Config;