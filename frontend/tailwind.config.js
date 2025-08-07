/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        futuristic: ['"Audiowide"', "sans-serif"], // For headings
        body: ['"Exo 2"', "sans-serif"], // For everything else
      },
    },
  },
  plugins: [],
};
