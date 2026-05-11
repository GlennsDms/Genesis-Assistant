<div align="center">

<img src="docs/assets/genesis-logo.png" alt="Genesis Assistant" width="120" />

# Genesis Assistant

**Your personal desktop assistant. Reminders, calendar, and AI chat — in a single binary.**

[![Version](https://img.shields.io/github/v/release/GlennsDms/Genesis-Assistant?color=e60012&style=flat-square)](https://github.com/GlennsDms/Genesis-Assistant/releases)
[![License](https://img.shields.io/github/license/GlennsDms/Genesis-Assistant?color=141414&style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows-faf6ee?style=flat-square)](#download)
[![Stack](https://img.shields.io/badge/stack-Tauri%202%20%C2%B7%20React%20%C2%B7%20Rust-faf6ee?style=flat-square)](#how-it-works)

[**Download (Windows)**](https://github.com/GlennsDms/Genesis-Assistant/releases/latest) · [**Web**](https://glennsdms.github.io/Genesis-Assistant/) · [Español](README.md)

</div>

---

## What is this

Genesis is a desktop app that brings together what most people juggle across three separate tools — a calendar, a reminder list, and an AI chat — into a single window that lives on your machine.

The idea is simple: make personal life-management easy **without asking you for a subscription or sending your data to someone else's servers**. Reminders and events live in a local SQLite database. The chat connects to Google's free Gemini API using your own API key, so there's no middleman between you and the model: I don't proxy your calls, and your usage doesn't depend on a server I have to keep running.

It's not trying to compete with Notion or Google Calendar. It's an open source project meant to be small, understandable, and good at what it does.

## Demo

> *Real GIFs and screenshots coming soon. Placeholders for now.*

<div align="center">

<img src="docs/assets/demo-alarm.gif" alt="Full-screen reminder alarm" width="600" />

*Reminder triggering: native notification + full-screen alarm with sound.*

<br />

<img src="docs/assets/screen-calendar.png" alt="Monthly calendar view" width="800" />

*Monthly calendar with .ics import and multimodal side panel.*

<br />

<img src="docs/assets/screen-chat.png" alt="AI chat" width="800" />

*AI chat capable of creating events from natural language.*

</div>

## Download

<table>
  <tr>
    <td align="center" width="33%">
      <strong>Windows</strong><br />
      <em>10 / 11 · 64-bit</em><br /><br />
      <a href="https://github.com/GlennsDms/Genesis-Assistant/releases/latest">⬇ Download .exe</a>
    </td>
    <td align="center" width="33%">
      <strong>macOS</strong><br />
      <em>12+ · ARM/Intel</em><br /><br />
      <em>Coming soon</em>
    </td>
    <td align="center" width="33%">
      <strong>Linux</strong><br />
      <em>AppImage / deb / rpm</em><br /><br />
      <em>Coming soon</em>
    </td>
  </tr>
</table>

> **About Windows SmartScreen.** The installer isn't signed with a commercial certificate (they cost €100-400/year, not viable for an open source side project). Windows will show a warning the first time: click *"More info"* → *"Run anyway"*. It's safe: the code being executed is exactly what's in this repository, you can audit it.

## How it works

Genesis is built with **Tauri 2** (which serves a web frontend from a native Rust backend). The frontend is **React 18 + TypeScript** with no UI library — every line of CSS is hand-written to keep the bundle small and the look consistent. Persistence is **SQLite** via `tauri-plugin-sql`, with versioned migrations. Notifications are native to the OS, not in-window toasts.

The AI chat uses **Gemini 2.5 Flash** via Google's official API. The API key is stored in the user's own database (`app_settings`) and never leaves the PC. The model supports *function calling*, letting the AI create events directly from natural conversation: *"add a meeting with Ana on Monday at 10"* becomes an actual event in your calendar.

A few technical choices and their reasoning:

- **Tauri instead of Electron.** An Electron installer weighs 80-120 MB. Tauri produces 5-15 MB binaries because it uses the OS's web engine rather than bundling Chromium. The app starts faster and uses less RAM.
- **SQLite instead of localStorage.** localStorage is unschematized plain text, easy to corrupt, no migrations. SQLite with versioned migrations lets the data model evolve between releases without losing user data.
- **No UI library.** Tailwind, MUI, or shadcn would have sped up the first few weeks but imposed a generic look. Hand-rolled CSS keeps the design free and the bundle around 200 KB.
- **BYOK (Bring Your Own Key) for AI.** Rather than me footing the bill for Gemini calls (unsustainable) or charging a subscription (high friction), the user provides their own free API key. It's the only honest way to ship real AI at zero ongoing cost and without routing user messages through an intermediary.

## Run it locally

If you want to build from source or contribute, you need **Node.js 20+** and **Rust** (`rustup` installs it). Then:

```bash
git clone https://github.com/GlennsDms/Genesis-Assistant.git
cd Genesis-Assistant/app
npm install
npx tauri dev
```

The first Rust compilation takes 5-15 minutes. Subsequent ones are quick.

To generate a release installer:

```bash
npx tauri build
```

The binary lands in `src-tauri/target/release/bundle/nsis/`.

## What's here and what's not

**Today:**

- Reminders with native notifications and a full-screen alarm.
- Monthly calendar view with `.ics` import (Google Calendar, Outlook, Apple Calendar all export this format).
- AI chat capable of creating events from natural language.
- Local SQLite persistence with versioned migrations.
- System tray integration so the app lives quietly in the background.

**On the roadmap:**

- Automated multi-platform builds via GitHub Actions (macOS, Linux).
- Weekly and list views for the calendar.
- Proper API key encryption with Stronghold (today it's stored plaintext in SQLite — works fine but is documented technical debt).

**Probably never:**

- Google Calendar/Outlook OAuth sync. Too much complexity for a personal project, and it would break the "your data lives on your PC" property. `.ics` import covers most of the actual need.
- Mobile app. Tauri 2 supports it but mobile isn't the use case Genesis was designed for.

## License

[MIT](LICENSE). Use it, modify it, redistribute it — freely.

## Acknowledgments

To [Tauri](https://tauri.app/) for finally making native desktop apps from web tech actually viable. To the [React](https://react.dev/) and [Vite](https://vite.dev/) teams for the foundation. To Google for keeping a genuinely free tier on Gemini.

And to caffeine. Above all, to caffeine.
