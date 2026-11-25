# ريل ميكر (ReelMaker)

Idea -> Arabic script -> Arabic voice -> captioned 9:16 video -> download / share / YouTube upload.
Pure static site (HTML/JS). No server, no database, no paid service. Everything runs in the user's browser.

## Run locally
    python3 -m http.server 8000   # then open http://localhost:8000  (Chrome or Edge)

## Host for free
Drop this folder on Cloudflare Pages, GitHub Pages or Netlify (all free tiers). No build step.

## Setup (all free)
1. Gemini key: https://aistudio.google.com/apikey -> paste in Settings. Without it the app runs in demo mode (sample script, tone instead of voice).
   Model names are editable in Settings (defaults gemini-3.8-flash and gemini-3.8-flash-tts). Free-tier limits are low and Google may use free-tier content to improve its products.
2. YouTube upload: Google Cloud Console (free) -> new project -> enable "YouTube Data API v3" -> OAuth consent screen (External, Testing; add your Google account as a test user) -> Credentials -> OAuth client ID (Web) with your site URL under Authorized JavaScript origins. Paste the Client ID in Settings.
   Uploads go in as PRIVATE. Public sign-ups need Google's app verification and a quota audit (default 100 uploads/day for the whole project).
3. TikTok / Instagram / Facebook: download or use the Share button (mobile). Direct posting needs platform app review (TikTok audit, Meta app review), which takes weeks.

## Real vs placeholder
Real: script, voice, captions, video render, download, share sheet, YouTube upload code, plan limits (per device).
Placeholder: payments and accounts (plans only change the local monthly limit), AI video clips (Pro/Business), photo/stock visuals (background is generated gradients), TikTok/IG/FB direct posting.
Not tested live: Gemini calls and YouTube upload (no key / client ID available). Render pipeline tested in headless Chrome in demo mode.
