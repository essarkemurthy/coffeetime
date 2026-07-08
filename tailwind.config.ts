import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Warm coffee-shop palette used across the app.
        coffee: {
          50: "#faf6f1",
          100: "#f0e6d9",
          200: "#e0ccb3",
          300: "#cba985",
          400: "#b8875f",
          500: "#a86f47",
          600: "#8f583a",
          700: "#744432",
          800: "#61392e",
          900: "#533229",
        },
      },
    },
  },
  plugins: [],
};

export default config;
