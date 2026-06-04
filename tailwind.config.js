/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{html,js}"],
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
