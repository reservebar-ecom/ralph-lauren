/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "faq/index.html", "./new-homepage.html"],
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
