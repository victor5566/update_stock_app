/** @type {import('tailwindcss').Config} */
// Tailwind CSS v3 (create-react-app's build picks this file up automatically). It scans src/
// for class names, so write them as complete strings. Dark mode follows the OS.
module.exports = {
  content: ['./src/**/*.{js,jsx}', './public/index.html'],
  theme: {
    extend: {},
  },
  plugins: [],
};
