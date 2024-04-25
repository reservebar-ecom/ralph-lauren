/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "faq/index.html"],
  theme: {
    extend: {
      fontFamily: {
        leJeune: ['"LeJeuneDeck"'],
        foundersGrotesk: ['"FoundersGrotesk"'],
      },
    },
  },
  plugins: [],
};
