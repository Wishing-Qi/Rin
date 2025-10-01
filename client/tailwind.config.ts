/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: ['selector','[data-color-mode="dark"]'],
  colors: {
    'theme': '#8dd1d2',           // 原色 +10% 明度
    'theme-hover': '#76c0c1',     // +5% 明度
    'theme-active': '#5ba9aa',    // -10% 明度
    'background': {
      light: '#f4fdfd',           // 极浅薄荷
      dark: '#102828',            // 深墨绿
    },
    'dark': '#1f3132',
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}

