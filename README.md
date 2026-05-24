# 🛡 O-LiP — AI Security Review for GitHub

O-LiP is a Chrome extension that automatically analyzes GitHub Pull Request diffs for security vulnerabilities using Claude AI (Anthropic).

## Features

- **AI-powered security analysis** — uses Claude to detect real vulnerabilities in PR diffs
- **Auto-scans PR diffs** when you open the Files Changed tab
- **Security score** (0–100) with color-coded risk indicator
- **Detailed findings** with severity, impact, and exact fix recommendations
- **Patch suggestions** — copy-ready secure code snippets
- **Category breakdown** — injection, secrets, auth, XSS, crypto, deps
- **Dark, minimal UI** that doesn't get in the way of GitHub

## Detected Vulnerability Types

- SQL / Command / LDAP injection
- Hardcoded secrets, API keys, passwords
- Authentication & authorization flaws
- Cross-site scripting (XSS)
- Insecure cryptography / weak random generation
- Server-side request forgery (SSRF)
- Unsafe deserialization
- Sensitive data exposure
- Path traversal
- Race conditions

---

## Installation (Chrome / Edge)

1. Open Chrome and go to: `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top right)
3. Click **Load unpacked**
4. Select the `o-lip-extension` folder
5. The O-LiP icon will appear in your toolbar

## Setup

1. Click the **O-LiP shield icon** in your Chrome toolbar
2. Enter your **Anthropic API key** (get one at [console.anthropic.com/keys](https://console.anthropic.com/keys))
3. Click **Save Settings**

## Usage

1. Open any GitHub Pull Request
2. Navigate to the **Files changed** tab
3. O-LiP will automatically appear in the bottom-right corner and begin scanning
4. Click any finding to expand it and see the full description, impact, and fix suggestion
5. Use the **Copy** button to grab the suggested secure code patch

> **Tip:** You can also click **Re-scan** at any time to re-analyze the diff.

---

## Architecture

```
Content Script (content.js)
  ↓ extracts diff from GitHub DOM
Background Service Worker (service-worker.js)
  ↓ sends diff to Anthropic API
Claude AI
  ↓ returns structured JSON with findings
Content Script
  ↓ renders panel with score, categories, findings
```

## Privacy

- Your API key is stored locally in Chrome's extension storage (`chrome.storage.sync`)
- Code diffs are sent directly from your browser to the Anthropic API — no intermediate server
- Nothing is logged or stored outside your browser

---

## Tech Stack

- Chrome Manifest V3 extension
- Vanilla JS + CSS (no build step needed)
- Anthropic Claude API (`claude-sonnet-4-20250514`)
- JetBrains Mono + Syne fonts

## File Structure

```
o-lip-extension/
├── manifest.json          # Chrome extension config
├── background/
│   └── service-worker.js  # API calls to Anthropic
├── content/
│   ├── content.js         # GitHub page injection + UI
│   └── content.css        # Panel styles
├── popup/
│   ├── popup.html         # Settings page
│   └── popup.js           # Settings logic
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```
