# RCG Discovery PWA — Setup Guide

## Files in This Build
- index.html — The complete PWA (entry, session, results, admin)
- manifest.json — Makes it installable on phones
- sw.js — Service worker for offline capability
- SETUP.md — This file

---

## Step 1 — Add Your OpenAI API Key

Open index.html and find this section near the top of the script:

```
const CONFIG = {
  openaiApiKey: 'YOUR_OPENAI_API_KEY',
```

Replace 'YOUR_OPENAI_API_KEY' with your actual OpenAI API key.
Get it from: https://platform.openai.com/api-keys

---

## Step 2 — Add Your Make Webhook URL

In the same CONFIG block:
```
makeWebhookUrl: 'YOUR_MAKE_WEBHOOK_URL',
```

Replace with the webhook URL from your Make.com scenario (the one that fires your iPhone notification).

---

## Step 3 — Set Your Admin Password

In the CONFIG block:
```
adminPassword: 'rcg2026',
```

Change 'rcg2026' to a strong passphrase you will remember.

---

## Step 4 — Upload to GitHub

1. Go to github.com and log in (TravisRobinsonJr)
2. Find your discovery.robinsoncreativegroup.com repository
3. Replace the existing files with these new files
4. Netlify will automatically redeploy

---

## Step 5 — Add App Icons

Create a folder called "icons" in the same location as index.html.
Add two PNG images:
- icons/icon-192.png (192x192 pixels, RCG mark on black background)
- icons/icon-512.png (512x512 pixels, same)

This makes the PWA look branded when installed on a phone.
(You can add a real logo here once you have one.)

---

## Step 6 — Register the Service Worker

Add this just before the closing </body> tag in index.html:

```html
<script>
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js');
  }
</script>
```

(This is already in the file — just confirming.)

---

## How to Access the Admin Panel

Option 1: On the entry screen, tap the footer text ("Products are copyable...") THREE times quickly. The admin login will appear.

Option 2: Go directly to discovery.robinsoncreativegroup.com and add #admin to the URL (future enhancement).

---

## Assistant IDs (Already Configured)

- Founder: asst_tA3jJ7ARTK4YwNNAM1m3efUJ
- Artist: asst_QIdgHVMGh0YsMJj9sb6p5Lsp

---

## How Sessions Are Stored (Phase 1)

Sessions are stored in the browser's localStorage on the device that ran the session. This means:

- If a client does their session on YOUR phone/laptop, it saves locally and you see it in admin.
- If they do it on THEIR device, you won't see it in admin yet.

Phase 2 upgrade: Connect Firebase so all sessions from all devices flow into your admin panel in real time. We'll build that next.

---

## Voice Behavior

- Client taps the microphone button to start speaking
- After 2 seconds of silence, their response is automatically sent
- The guide responds in text AND reads it aloud (text-to-speech)
- Client taps mic again for their next response
- No push-and-hold required

---

## Next Build (Phase 2)

1. Firebase integration — all sessions centralized regardless of device
2. Auto-extract S.O.U.L. score and archetype signals from transcript
3. GPT2 input block auto-generated and ready to copy
4. Session search and filter in admin panel
