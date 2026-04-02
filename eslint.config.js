import globals from "globals";
import pluginJs from "@eslint/js";
import sonarjs from "eslint-plugin-sonarjs";

export default [
  pluginJs.configs.recommended,
  sonarjs.configs.recommended,
  {
    rules: {
      "sonarjs/no-duplicate-string": "warn",
      "sonarjs/no-unused-vars": "off",
      "sonarjs/cognitive-complexity": "off",
    },
  },
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ["**/tests/**", "**/*.test.js", "**/*.spec.js"],
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
    rules: {
      "no-magic-numbers": "off",
    },
  },
  {
    rules: {
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "no-undef": "error",
      "no-magic-numbers": [
        "error",
        {
          ignore: [-1, 0, 1],
          ignoreArrayIndexes: true,
          enforceConst: true,
          detectObjects: false,
        },
      ],
    },
  },
  {
    files: ["src/consts/**/*.js", "src/consts/*.js"],
    rules: {
      "no-magic-numbers": "off",
      "sonarjs/no-hardcoded-ip": "off",
      "sonarjs/publicly-writable-directories": "off",
    },
  },
  {
    ignores: ["node_modules/", "coverage/", "dist/", ".agent/"],
  },
];
