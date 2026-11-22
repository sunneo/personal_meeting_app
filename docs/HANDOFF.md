# HANDOFF — personal_meeting_app

## 1. Opening prompt
Continue from the handoff document at D:\Downloads\personal_meeting_app\docs\HANDOFF.md. Read it fully, including the verbatim user words and the working style, and follow them. Run the low-context-long-run skill (THRESHOLD 70% for Haiku): do the next todo item, and when your context reaches the threshold, write the next handoff and start your own successor (model haiku, effort high). As your first message, confirm in one line that you read the document and which todo item you are starting.

## 2. Overview
- Repo: D:\Downloads\personal_meeting_app (branch main, remote git@github.com:sunneo/personal_meeting_app.git, currently only README+LICENSE, commit 8f0f821). Public page: https://sunneo.github.io/personal_meeting_app/ (GitHub Pages; static web app, so no server code in-repo).
- Reference/shared infra: D:\Downloads\videos-嗨投資-desktop-app\desktop-app (huge; do NOT scan it wholesale). Cloudflare worker example: desktop-app\cloudflare\fa-worker\README.md. Supabase/cloudflare usage mentioned in DESIGN.remote-group.md, DESIGN.release.md, DESIGN.sandbox-worker.md, features\FEATURES.md. Goal: reuse the SAME Cloudflare + Supabase projects as the desktop-app (read its config/env names; never commit secrets).
- Goal: a messenger web app (static, GitHub Pages).
- Done so far (all todo 1–9 committed on main; NOT pushed, NOT deployed): DESIGN.md `690197e`; scaffold `aa8935e`; text+TTS `4fc55c3`; files `d26ed46`; voice+subtitles `ce18306`; IndexedDB+persist `35e348e`; Supabase path A `f3c8e01` + wiring `a7a37a9`; Cloudflare archive-worker path B `f3dab73`; tests+README `ae135a1`.
- Not yet verified in a real browser (only syntax-checked and pure-logic tests run). Not yet wired: UI for attachments to path B, Supabase history pull, `js/config.js` values (user to fill).

## 3. Todo (ordered)
1. Read the desktop-app cloudflare/supabase docs above (targeted reads only); write docs/DESIGN.md: architecture, Supabase tables/storage, Cloudflare worker routes, message JSONL schema.
2. Scaffold static web app at repo root (index.html + js modules, no build step, GitHub Pages friendly). Commit.
3. Text chat; every text bubble has a play-sound button (Web Speech API TTS).
4. Send files: audio/music (built-in player), PDF (open in built-in viewer, e.g. pdf.js from cdnjs or iframe/object), other documents (download).
5. Microphone voice message (MediaRecorder); below each voice message list its subtitle (transcript; Web Speech API SpeechRecognition live while recording, plus editable/fallback).
6. Short-term storage: IndexedDB + navigator.storage.persist().
7. Long-term storage path A: Supabase (same project as desktop-app).
8. Long-term path B: Cloudflare Worker (write worker source + wrangler.toml under cloudflare/, API key stored as worker secret, never in repo) uploading to private repo https://github.com/sunneo/personal_meeting_app_repo.git on a branch. Layout: per-month `YYYY-MM/conversation.jsonl` + `manifest.json`; attachments in `YYYY-MM/<category>/`; files over 20MB split into 20MB parts (record part list in manifest).
9. Tests for pure logic (chunking, month partition, jsonl); README with setup. Deployment/secrets setup is for the user: list steps, don't do them.

## 4. Working style
- Reply in Traditional Chinese (user's language). Commit small batches; commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Do not push or deploy unless the user says so. No secrets in the repo. Work only in the todo scope. Handoff only at committed batch boundaries.

## 5. Verbatim user words (2026-11-22)
> 這個專案有公開網頁 https://sunneo.github.io/personal_meeting_app/
> 我希望他能跟 desktop-app 一樣，共用cloudflare, supabase
> 這個專案的目標是用web app實現通訊軟體
> 通訊軟體可以傳聲音，音樂，文件檔案，內建聲音播放，pdf開啟，可以用麥克風傳語音過去，麥克風傳過去的語音在下面列出這個語音應該有什麼字幕
> 可以文字交流，每個文字泡泡都有聲音
> 短期訊息暫時儲存在使用者的indexdb/persistentStorage，長期訊息有兩個儲存路徑，一個是supabase, 一個在cloudflare建立api key來上傳到private repository的branch
> https://github.com/sunneo/personal_meeting_app_repo.git
> 例如逐月分一個conversation.jsonl, manifest
> 附件檔案逐月份放/分類，大檔要切20MB一份
> 領導的model如果是sonnet , subsession用haiku , high; haiku如果要handoff, 他的context是設定70%

## 6. Handoff procedure
Run the low-context-long-run skill with THRESHOLD 70%. Successor: model haiku, effort high, initiation user_asked, context fresh, same cwd; title "personal_meeting_app worker · handoff N". Finish the todo list → report completion, don't hand off.

## 7. Traps
- desktop-app grep over whole tree times out; use targeted paths.
- Repo is a static GitHub Pages site: no secrets client-side beyond Supabase anon key.
