# HANDOFF — personal_meeting_app

## 1. Opening prompt
Continue from the handoff document at D:\Downloads\personal_meeting_app\docs\HANDOFF.md. Read it fully, including the verbatim user words and the working style, and follow them. Run the low-context-long-run skill (THRESHOLD 70% for Haiku): do the next todo item, and when your context reaches the threshold, write the next handoff and start your own successor (model haiku, effort high). As your first message, confirm in one line that you read the document and which todo item you are starting.

## 2. Overview
- Repo: D:\Downloads\personal_meeting_app (branch main, remote git@github.com:sunneo/personal_meeting_app.git, currently only README+LICENSE, commit 8f0f821). Public page: https://sunneo.github.io/personal_meeting_app/ (GitHub Pages; static web app, so no server code in-repo).
- Reference/shared infra: D:\Downloads\videos-嗨投資-desktop-app\desktop-app (huge; do NOT scan it wholesale). Cloudflare worker example: desktop-app\cloudflare\fa-worker\README.md. Supabase/cloudflare usage mentioned in DESIGN.remote-group.md, DESIGN.release.md, DESIGN.sandbox-worker.md, features\FEATURES.md. Goal: reuse the SAME Cloudflare + Supabase projects as the desktop-app (read its config/env names; never commit secrets).
- Goal: a messenger web app (static, GitHub Pages).
- Done so far (all todo 1–9 committed on main; NOT pushed, NOT deployed): DESIGN.md `690197e`; scaffold `aa8935e`; text+TTS `4fc55c3`; files `d26ed46`; voice+subtitles `ce18306`; IndexedDB+persist `35e348e`; Supabase path A `f3c8e01` + wiring `a7a37a9`; Cloudflare archive-worker path B `f3dab73`; tests+README `ae135a1`.
- Phase 2 (A→B→C→D) committed, NOT pushed/deployed: auth design `4fcd008`; auth logic `6cd1827`; worker login/register + token gate `aab0418`; archive client `fd90aee`; app login+archive sync `12e12c3`; prefs/avatar `521ce27`; notifications `e4c6b73`; storage mgmt `8b0fce2`; stickers `154f1d0`+`1445cbf`; video `23f80a2`; friends/groups `cf33539`+`adbdc94`; DESIGN §12–13 `69f47cf`; README `45d0bf9`. QR code and cross-device sync NOT done (see DESIGN §13).
- Not yet verified in a real browser (only syntax-checked and pure-logic tests run). Not yet wired: UI for attachments to path B, Supabase history pull, `js/config.js` values (user to fill).

## 3. Todo (ordered)
Items 1-9 of the original plan are DONE (see git log). Phase 2 (2026-11-22), do in this order, commit per item, keep tests green:
A. Security design FIRST (write docs/DESIGN.auth.md, then implement): the user asked to "內建金鑰到頁面" but ARCHIVE_KEY/GH_TOKEN must NOT ship in the public page (GitHub Pages source is world-readable). Intent = "留一個後台放這類密碼": keep secrets in the Cloudflare worker (backend). Page logs in with account code + password; worker verifies (PBKDF2/Argon-style hash, salt, rate limit) and returns a short-lived signed session token (HMAC with a worker secret SESSION_SECRET); archive routes accept that token instead of X-Archive-Key. Accounts/profiles/friends/groups/stickers metadata stored in Cloudflare KV (binding `KV`, already used by desktop fa-worker pattern) and/or Supabase; choose and document. Tell the user which new bindings/secrets they must add.
B. Wire frontend to archive worker: append JSONL per message (/append), attachments (/attachment, 20MB parts), pending-queue retry, use session token.
C. Features (user list, verbatim below): 1 register/login (code + password confirm); 2 avatar + preferences (font size, font family, width); 3 notifications (phone/web Notification API, pick sound, upload custom sound); 4 storage-space management (show usage by IndexedDB/persist estimate, clear/delete items); 5 friends list; 6 sticker library (default YAML format describing svg and gif animations; import/export); 7 chat videos do not autoplay, click to play, fullscreen allowed; 8 create chat groups; 9 share via share-code or QR code (generate QR client-side with a small cdnjs lib or own implementation).
D. Tests for pure logic (auth token sign/verify, yaml sticker parsing, share code); update README/DESIGN; list deploy steps for user.
E. (Phase 3, after A-D) WebRTC video chat (1-to-1 first, small group mesh optional): signaling via Supabase Realtime broadcast channels (primary; use the failover project list) with Cloudflare worker as fallback (KV polling like desktop-app fa-worker). ICE: public STUN; TURN credentials minted by the worker (Cloudflare Calls TURN or similar; keys stay in worker secrets, session-token protected, short TTL; if user has not configured TURN, fall back to STUN-only and say so). UI: call button in chat/group, camera/mic toggle, front/rear camera switch on phones (facingMode user/environment via getUserMedia constraints, or enumerateDevices deviceId; replace the video track on the RTCPeerConnection sender with replaceTrack, no renegotiation; hide the button if only one camera), screen share optional, fullscreen. Recording during a call: user can record audio-only or video (MediaRecorder on local+remote streams; mix both audio tracks via WebAudio MediaStreamDestination, compose video via canvas captureStream or record remote only; pick supported mimeType via isTypeSupported). Visible REC indicator, and notify the other party when recording starts (privacy; consent notice via data channel/signaling). CHANGED by user: recordings do NOT appear in the two-person conversation. They go to the user's own private Recording Library (錄音錄影庫), stored by default in IndexedDB (persist), with list/play (video click-to-play, fullscreen)/rename/delete/download; 「fap」 = File System Access API (confirmed by user 2026-11-22): in addition to IndexedDB the user can choose a local folder (showDirectoryPicker, remember handle in IndexedDB, re-request permission) to save recordings; feature-detect and hide on unsupported browsers (most phones), fall back to download. Optional later: user-initiated upload of a recording through the archive path. Pure logic (signaling message schema, state machine) gets tests. List the bindings/secrets the user must add.

Rule: if a phase is too big, split into more commits; hand off at 70% context.

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

> 請 worker 接上歸檔上傳
> 我希望可以直接內建金鑰到頁面
> 因為是設計成通訊軟體
> 我們就留一個後台放這類密碼
> 1. 申請帳號，輸入密碼確認，帳號是代號
> 2. 帳號可以設定頭像跟user preference，像是顯示字體大小，字體，寬度
> 3. 可以設定通知方式(使用手機/網頁通知，可以選音效，可以上傳音效)
> 4. 可以管理自己的儲存空間
> 5. 可以管理好友清單
> 6. 可以管理貼圖庫，貼圖格式預設用yaml描述，內含svg, gif動畫
> 7. 貼到聊天視窗的影片不自動播放，點一下來播放，可以全螢幕
> 8. 可以建立聊天群組
> 9. 使用者可以用分享代號或QRCode的方式
> 幫我加上備援專案自動切換 (done)
> archive worker URL: https://personal-meeting.sunneo529.workers.dev (deployed by user; vars ARCHIVE_REPO=sunneo/personal_meeting_app_repo, ARCHIVE_BRANCH=archive; secrets GH_TOKEN, ARCHIVE_KEY set)  (2026-11-22)

> 要利用supabase/cloudflare的能力來做到webrtc，做到視訊聊天  (2026-11-22)

> 鏡頭在手機上可以選擇前後鏡頭  (2026-11-22)

> 使用者可以在視訊期間錄音或錄影  (2026-11-22)

> 錄音錄影的結果不出現在兩人對話，紀錄在自己的錄音錄影庫，預設放在indexdb，使用者可以用fap  (2026-11-22)

## 6. Handoff procedure
Run the low-context-long-run skill with THRESHOLD 70%. Successor: model haiku, effort high, initiation user_asked, context fresh, same cwd; title "personal_meeting_app worker · handoff N". Finish the todo list → report completion, don't hand off.

## 7. Traps
- desktop-app grep over whole tree times out; use targeted paths.
- Repo is a static GitHub Pages site: no secrets client-side beyond Supabase anon key.
