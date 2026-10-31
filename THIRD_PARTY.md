# Third-party material

VideoGen builds on these projects and assets. Their licences apply to the parts named.

| What | Where in this repo | Source | Licence |
|---|---|---|---|
| Lemo-Opuscar style library: render, voice, mix and mux tools; style guides that the instant templates follow | Not vendored. Cloned at build time to `~/lemo-opuscar` | [lemomo-ai/lemo-opuscar](https://github.com/lemomo-ai/lemo-opuscar) by LemoLab | MIT (code) |
| Style frames shown in the Styles gallery and on the sign-in page | `app/public/gallery/frames/` | Lemo-Opuscar `docs/frames`, by LemoLab | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/): credit "LemoLab" with a link to the repository |
| Style demo films | Not vendored. Streamed from the official gallery site | LemoLab | CC BY 4.0 |
| Brand Kit starting themes (palettes and moods) | `app/lib/brands.mjs` (`PRESETS`) | Adapted from Anthropic's [theme-factory](https://github.com/anthropics/skills) skill: colours mapped to five roles, Google Fonts substituted | Apache-2.0 |
| Inter, Archivo, JetBrains Mono | `app/templates/shared/fonts/` (licence files alongside) | Google Fonts | SIL Open Font License 1.1 |
| Brand-kit fonts (27 families) | Not vendored. Fetched on first use from [google/fonts](https://github.com/google/fonts) with their `OFL.txt` | Google Fonts | SIL Open Font License 1.1 |
| Kokoro TTS model and voices | Not vendored. Downloaded by the library's setup | [hexgrad/Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) via kokoro-onnx | Apache-2.0 |
| Google "G" mark on the sign-in button | `app/public/login.html` | Google | Used per Google's Sign-In branding guidelines |

The template teasers in `app/public/gallery/teasers/` were rendered by VideoGen's own templates.
