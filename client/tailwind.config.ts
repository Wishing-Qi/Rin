/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "../packages/ui/src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: ['selector','[data-color-mode="dark"]'],
  theme: {
    extend: {
      colors: {
        'theme': 'rgb(var(--theme-rgb) / <alpha-value>)',
        'theme-hover': 'rgb(var(--theme-hover-rgb) / <alpha-value>)',
        'theme-active': 'rgb(var(--theme-active-rgb) / <alpha-value>)',
        'background': {
          light: '#f4fdfd',           // 极浅薄荷
          dark: '#102828',            // 深墨绿
        },
        'dark': '#1f3132',
      }
    }
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
