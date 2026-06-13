import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      ".vercel/**",
      "node_modules/**",
      "out/**",
      "build/**",
      "dist/**",
      "test-results/**",
      "playwright-report/**",
      "*.tsbuildinfo",
    ],
  },
  ...nextVitals,
  ...nextTypescript,
];

export default eslintConfig;
