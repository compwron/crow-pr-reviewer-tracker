// Keeps dev-only files out of the packaged add-on
export default {
  sourceDir: ".",
  ignoreFiles: [
    "test",
    "package.json",
    "package-lock.json",
    "web-ext-config.mjs",
    "PROMPT.md",
    "CLAUDE.md",
  ],
};
