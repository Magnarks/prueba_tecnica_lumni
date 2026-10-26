# React + TypeScript + Vite

Esta plantilla ofrece una configuración mínima para trabajar con React y Vite, con recarga en caliente (HMR) y algunas reglas de ESLint.

Actualmente hay dos plugins oficiales disponibles:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) usa [Oxc](https://oxc.rs).
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) usa [SWC](https://swc.rs/).

## Compilador de React

El Compilador de React no está habilitado en esta plantilla porque puede afectar el rendimiento durante el desarrollo y la compilación. Para agregarlo, consulta [esta documentación](https://react.dev/learn/react-compiler/installation).

## Ampliar la configuración de ESLint

Si vas a usar este proyecto en producción, recomendamos actualizar la configuración para habilitar reglas de análisis con información de tipos:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Otras configuraciones...

      // Quita tseslint.configs.recommended y reemplázalo por esto.
      tseslint.configs.recommendedTypeChecked,
      // Como alternativa, usa esto para reglas más estrictas.
      tseslint.configs.strictTypeChecked,
      // Opcionalmente, agrega esto para incluir reglas de estilo.
      tseslint.configs.stylisticTypeChecked,

      // Otras configuraciones...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // Otras opciones...
    },
  },
])

```

También puedes instalar [eslint-plugin-react-x](https://npmx.dev/package/eslint-plugin-react-x) y [eslint-plugin-react-dom](https://npmx.dev/package/eslint-plugin-react-dom) para agregar reglas de análisis específicas de React:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Otras configuraciones...
      // Habilita las reglas de análisis para React.
      reactX.configs['recommended-typescript'],
      // Habilita las reglas de análisis para React DOM.
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // Otras opciones...
    },
  },
])

```
