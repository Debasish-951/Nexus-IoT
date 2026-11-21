# Interface languages

The top bar has a **Language** button, left of Appearance. It offers English (the default), Japanese (日本語), Hindi (हिन्दी) and Telugu (తెలుగు). The choice is remembered per browser and applies at once, without reloading.

## What is translated

Only interface text is translated. Data is always shown exactly as stored: project names, asset names, attribute names and values, units that come with telemetry, machine instance names such as `P-101`, and anything a user typed (twin names, folder names, dashboard names).

Translation is rolled out screen by screen. A screen that is not done yet stays in English.

| Area | Status |
|---|---|
| Main menu, sidebar, top bar (Language, Appearance, profile menu, Change Password) | Translated |
| Home (greeting, project list) | Translated |
| Live Twin: page, twin types, side panel and folders, toolbar, Save dialogs, 3D views, Add twin library (machine names, groups, readings), industry templates and process areas, Data Source panel, Scenario, Live tags, trend graphs, detailed pump skid, process twin | Translated |
| Live Twin: 2D twin point editor (beyond its toolbar) | Not yet |
| Assets, Asset Templates, Media Library | Not yet |
| Visualization, dashboard widgets, Asset Template, Live Feed | Not yet |
| AI Advisor: mode cards and AI Reports page | Translated (the AI-written text itself is in English) |
| AI Advisor chat, Event Manager, Integration Hub, Governance, Data Management, Reports, Audit Log | Not yet |
| Sign-in, activation and password-reset pages | Not yet |
| Messages that come from the server (errors, validation) | Not yet; shown in English |

The Japanese, Hindi and Telugu texts were machine-written and are waiting for review by native speakers.

## How it works

- `artifacts/iot-platform/src/i18n/index.ts` holds the current language, `setLang()`, and the `useT()` hook. A component calls `const t = useT();` and writes `t("Save")`; it re-renders when the language changes.
- The English text is the key. A string with no translation shows in English, so a missing entry never breaks a screen.
- `{name}` placeholders are filled from the second argument: `t("Delete \"{name}\"?", { name })`. Pass data (names, values) only through placeholders, never through `t()` itself.
- One file per language: `src/i18n/ja.ts`, `hi.ts`, `te.ts`. Each maps English text to the translation. Reviewers correct a language in its file only.
- `document.documentElement.lang` follows the choice, so the browser picks suitable fonts and screen readers the right voice.

## Translating another screen

1. In the screen's components, add `const t = useT();` and wrap each visible English string, `title`, `aria-label` and `placeholder` in `t(...)`. Leave data alone.
2. Add every new English string to `ja.ts`, `hi.ts` and `te.ts`.
3. Update the table above.
