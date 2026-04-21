/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        gold: "#C9A96E",
        charcoal: "#1A1A1A",
        cream: "#FAF6F0",
        "cream-dark": "#F0E9DC",
        "charcoal-muted": "#4A4A4A",
      },
      fontFamily: {
        serif: ["Cormorant Garamond", "serif"],
        sans: ["Outfit", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
