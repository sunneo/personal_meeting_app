# DESIGN — personal_meeting_app（網頁版通訊軟體）

狀態：設計草稿（todo 1）。尚未實作任何功能程式。

## 1. 目標與限制

- 靜態網頁（GitHub Pages：`https://sunneo.github.io/personal_meeting_app/`），沒有伺服器程式，沒有建置步驟。
- 功能：文字聊天（每個文字泡泡都有朗讀按鈕）、傳送聲音／音樂／文件／PDF、內建播放與 PDF 開啟、麥克風語音訊息（下方列出字幕）。
- 與 desktop-app **共用** Cloudflare 與 Supabase（同一組帳號與專案，不另開新的）。
- 短期訊息存在瀏覽器 IndexedDB，並申請 `navigator.storage.persist()`。
- 長期訊息兩條路徑：(A) Supabase；(B) Cloudflare Worker 把資料上傳到私有 repo `https://github.com/sunneo/personal_meeting_app_repo.git` 的分支。
- 不推送、不部署；repo 內不放任何 secret。

## 2. 與 desktop-app 共用的基礎設施（已確認的事實）

來源（唯讀參考，路徑：`D:\Downloads\videos-嗨投資-desktop-app\desktop-app`）：

| 項目 | 位置 | 重點 |
|---|---|---|
| Supabase 資料庫腳本 | `supabase/remote_group.sql` | 表 `public.rg_rooms`（代號、驗證值、時間、失敗次數、鎖定時間）；RLS 開啟且不開放 anon/authenticated 直接存取；只能透過函式 `rg_create_room` / `rg_join_room` / `rg_touch_room` / `rg_close_room` 存取；`rg_cleanup()` 清閒置房間 |
| 即時通道用法 | `renderer/src/remote/rg_host.js` | Supabase Realtime 的「廣播（broadcast）」與「在線名單（presence）」；訊息端對端加密（AES-GCM），伺服器只看到密文 |
| Cloudflare Worker | `cloudflare/fa-worker/worker.js`、`wrangler.toml`、`README.md` | Worker 名稱 `lively-dream-c1f0`；綁定 KV（變數名 `KV`）；每 5 天 cron（`0 3 */5 * *`）保活四個 Supabase 專案；KV 當「慢速信箱」 |
| Supabase 專案 | `worker.js` 內 `PROJECTS` 陣列 | 四個專案（主要／備援／備援2／備援3）；網址與「publishable」公開金鑰寫在原始碼裡 |

注意：上述 publishable 金鑰屬於公開用途，但**本 repo 不複製金鑰值**；需要時從 desktop-app 的 `rg_host.js` 或 Worker 設定讀取，或由使用者提供。

## 3. 架構總覽

```
瀏覽器（GitHub Pages 靜態頁）
 ├─ UI 層：對話列表、泡泡、語音錄製、播放器、PDF 檢視
 ├─ 即時層（介面 Transport）──→ Supabase Realtime（廣播 + 在線名單）
 ├─ 短期儲存 ──→ IndexedDB（persist）
 ├─ 長期 A ──→ Supabase（資料表 / Storage，同一個專案）
 └─ 長期 B ──→ Cloudflare Worker（新，`cloudflare/archive-worker/`）──→ GitHub 私有 repo（分支）
```

即時層包成一個介面（加入頻道、送、收、在線名單），之後換實作只改這一層（與 desktop-app 的設計一致）。

## 4. 資料模型

### 4.1 訊息（JSONL 一行一則）

```json
{"v":1,"id":"<uuid>","ts":1732250000000,"conv":"<對話 id>","from":"<使用者 id>",
 "kind":"text|audio|voice|file",
 "body":"文字內容（text）",
 "subtitle":"語音字幕（voice，可編輯）",
 "attachments":[{"name":"a.mp3","mime":"audio/mpeg","size":123456,"sha256":"…",
                 "category":"audio|music|pdf|docs|voice|other",
                 "parts":[{"path":"2026-11/audio/a.mp3","index":1}]}]}
```

- `ts` 為毫秒 Unix 時間，用來決定月份分檔（以 UTC+8 或本機時間二選一，**待決定**；建議 UTC+8，與使用者所在時區一致）。
- 附件 `parts`：單檔 ≤ 20MB 時只有一個 part；超過 20MB 切成多份（`<name>.part001`、`part002`…），`manifest` 記錄順序與 sha256 以便還原。

### 4.2 本地（IndexedDB）

- `messages`：以 `id` 為主鍵，索引 `conv`、`ts`。
- `blobs`：附件二進位（大檔可能佔空間，`persist()` 授權後才可靠）。
- `outbox`：尚未送達的訊息（離線重送用）。

## 5. 長期儲存路徑 A：Supabase

- 沿用 desktop-app 的專案與 publishable 金鑰；本 app 用自己的表（例如 `pma_messages`、`pma_conversations`），**不與 `rg_*` 混用**。
- RLS 在建表時就開啟；前端只用有限權限。**需要的 SQL 檔放 `supabase/pma.sql`，由使用者在 SQL 編輯器執行**（我們不代為執行）。
- 附件可放 Supabase Storage（bucket 名 `pma-attachments`）；超過免費上限的檔案走路徑 B。
- 還沒確認的事（需要查官方文件，不憑記憶）：免費方案的 Storage 單檔上限與總量、閒置暫停規則。

### 5.1 多專案備援（已實作）

- 專案清單在 `js/config.js` 的 `SUPABASE_PROJECTS`，順序：主要 → 備援 → 備援2 → 備援3（取自 desktop-app 的 fa-worker）。
- **每一個備援專案都必須執行 `supabase/pma.sql`**。缺表或缺函式時 PostgREST 回 404，該專案視為不可用，程式改用下一個並在狀態列提示。
- 各專案資料互相獨立（不同的資料庫），不做同步；長期歸檔以 Cloudflare 路徑 B（`cloudflare/archive-worker`）為準。
- 選擇規則（`js/core/failover.js`，有單元測試）：
  - 每次先試記住的專案（localStorage `pma.supabase.state`）。
  - 單次請求逾時 8 秒；網路錯誤、5xx、404 都視為失敗，換下一個（循環）。
  - 記住的專案不是主要，且距上次試主要超過 10 分鐘，就先試主要一次。
  - 成功後記住該專案。
- 全部失敗時：訊息仍在 IndexedDB，標示 `pendingSync`（畫面顯示「⏳待補傳」）；啟動時、每分鐘與 `online` 事件時補傳。

## 6. 長期儲存路徑 B：Cloudflare Worker → 私有 repo

### 6.1 Worker

- 新 Worker 放 `cloudflare/archive-worker/`（`worker.js`、`wrangler.toml`、`README.md`）。不改動 `fa-worker`。
- Secrets（只存在 Cloudflare，不進 repo）：`GH_TOKEN`（fine-grained，僅限私有 repo `personal_meeting_app_repo`、Contents 讀寫）、`ARCHIVE_KEY`（前端呼叫時的共享密鑰，用來擋陌生人灌檔）。
- 端點（建議）：
  - `POST /append`：收一則訊息（JSON），寫入對應月份的 `conversation.jsonl` 與更新 `manifest.json`。
  - `PUT /attachment`：收附件（已切片），寫入 `YYYY-MM/<category>/`。
  - `GET /manifest?month=YYYY-MM`：讀清單。
- 寫入方式：GitHub Contents API，單次檔案 ≤ 20MB（超過就切片）；每次寫入先取得 `sha` 再更新，衝突時重試。

### 6.2 私有 repo 版面（分支：`archive`，**分支名待決定**）

```
YYYY-MM/
  conversation.jsonl      # 本月所有訊息，一行一則
  manifest.json           # 本月的附件清單：名稱、大小、sha256、分類、part 列表
  audio/                  # 聲音
  music/                  # 音樂
  pdf/
  docs/                   # 其他文件
  voice/                  # 語音訊息原檔
  other/
```

- 逐月一個 `conversation.jsonl`；附件依月份與分類放置。
- 大檔切 20MB 一份：`<name>.part001`…；`manifest.json` 記錄 part 清單與合併後的 sha256。
- Worker 只新增檔案或更新 `conversation.jsonl`／`manifest.json`；不刪除。

## 7. 語音與字幕

- 錄音用 `MediaRecorder`（`audio/webm` 或 `audio/mp4`，依瀏覽器支援）。
- 字幕：錄音中用 Web Speech API（`SpeechRecognition` / `webkitSpeechRecognition`）即時產生；送出後的 `subtitle` 可由使用者編輯。
- 字幕不支援時（例如 Firefox），泡泡只顯示「未產生字幕，可手動輸入」。
- 語音訊息原檔走附件路徑（`voice/`）；字幕寫在訊息的 `subtitle` 欄位。

## 8. 朗讀（每個文字泡泡都有聲音）

- 用 Web Speech API `speechSynthesis`，每個文字泡泡有一個播放鈕，`lang` 依文字判斷（中文用 `zh-TW`）。
- 不需要後端、不需要金鑰。

## 9. 測試策略

- 純邏輯放 `js/core/`，不依賴 DOM，可用 Node 內建 `node:test` 跑：月份分檔、JSONL 序列化／解析、切片（20MB 邊界）、manifest 還原、sha256 比對。
- 測試腳本：`npm test` 不需要安裝套件（只用 Node 內建）。**待決定**：是否要 `package.json`；建議有，但不引入相依套件。

## 10. 待使用者決定的事項

1. 長期分支名稱（建議 `archive`）。
2. 月份分檔時區（建議 UTC+8）。
3. Worker 是否新開一個（建議：新開 `archive-worker`，與 `fa-worker` 分開，避免互相影響）。
4. 私有 repo 的 fine-grained token 由使用者建立並交給 Worker secret（我們不建立帳號、不取得 token）。

## 11. 使用者需要自己做的部署步驟（只列出，不執行）

1. Supabase：在 SQL 編輯器執行 `supabase/pma.sql`（建立後提供）。
2. Cloudflare：建立 `archive-worker`，設定 secrets `GH_TOKEN`、`SESSION_SECRET`（選填 `TURNSTILE_SECRET`），變數 `REGISTRATION_MODE`（預設 `open`），新增 KV binding `KV`；舊的 `ARCHIVE_KEY` 可刪除（開放註冊防線見 `docs/DESIGN.auth.md` 第 7 節）
3. GitHub：建立分支 `archive`（或告訴我名稱）；建立 fine-grained token。
4. GitHub Pages：啟用 `main` 分支的 Pages（若尚未啟用）。

## 12. 貼圖 YAML 格式（已實作：`js/core/sticker-yaml.js`）

受限的 YAML 子集，只用來描述貼圖庫：

```yaml
# 貼圖庫
stickers:
  - name: smile
    type: svg
    data: |
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>
  - name: wave
    type: gif
    data: "data:image/gif;base64,R0lGOD..."
```

- 頂層只有 `stickers:`；每個項目以 `  - name:` 開頭，欄位縮排 4 格。
- `data` 可用 `|` 區塊、雙引號 JSON 字串，或未加引號的單行。
- `name`：小寫英數、底線、連字號，1–40 字，不可重複。
- `type` 只能是 `svg` 或 `gif`。
- svg：必須以 `<svg` 開頭，不可含 `<script`、`<foreignObject`、`on…=` 事件屬性、`javascript:`；顯示時只用 `<img>`。
- gif：必須是 `data:image/gif;base64,…`。
- 錯誤會回報行號。匯出的檔案一律用雙引號字串，可以直接再匯入。

## 13. Phase 2 功能狀態（2026-11-22）

| 項目 | 狀態 | 位置 |
|---|---|---|
| A 認證（帳號代號＋密碼，短效 HMAC token，密碼在 Worker） | 已實作＋單元測試；Worker 路由已寫，**尚未在 Cloudflare 部署驗證** | `cloudflare/archive-worker/auth.js`、`worker.js`、`docs/DESIGN.auth.md` |
| B 前端接上歸檔（登入、JSONL、附件 20MB 分片、待補傳） | 已實作；**尚未在瀏覽器實測** | `js/archive-client.js`、`js/app.js` |
| C1 註冊／登入（含密碼確認） | 已實作 | `index.html` 帳號區塊 |
| C2 偏好（字體大小、字體、寬度）與頭像 | 已實作（本機） | `js/core/prefs.js`、`js/settings.js` |
| C3 通知（網頁通知、音效、自訂音效 ≤1MB） | 已實作（本機）；**手機推播（Web Push）未實作**；尚無「收到他人訊息」的接收路徑，目前只有測試按鈕會觸發 | `js/core/notify.js`、`js/notify.js` |
| C4 儲存空間管理（用量估計、刪除本機訊息、清除本機） | 已實作；刪除只影響本機，不刪歸檔 | `js/core/storage-usage.js`、`js/store.js` |
| C5 好友清單 | 已實作（本機）；跨裝置同步未實作 | `js/core/social.js`、`js/social.js` |
| C6 貼圖庫（YAML，svg＋gif） | 已實作（本機，匯入／匯出，選擇器） | 第 12 節 |
| C7 聊天影片不自動播放、點擊播放、可全螢幕 | 已實作（`preload=none`，`controls` 內含全螢幕） | `js/app.js` `attachmentNode` |
| C8 建立群組（群主加人，上限 50） | 已實作（本機）；群組訊息的收發與同步未實作 | `js/core/social.js` |
| C9 分享代號（PMA1 格式＋校驗） | 已實作；**QR Code 未實作**（沒有經過驗證的離線函式庫，不硬塞） | `js/core/social.js` |
| D 純邏輯測試 | `npm test`（共 9 組） | `test/` |

已知限制（需要後續階段）：
- 好友、群組、偏好、貼圖目前只存在每台裝置的 localStorage／IndexedDB，**不會跨裝置同步**。要同步需要在 Worker 加一組以登入 token 保護的 KV 路由。
- 「收到他人訊息」的接收路徑（Supabase 讀取或 Worker 讀取）尚未實作，因此通知只能由測試按鈕觸發。
- 所有瀏覽器行為（錄音、通知、視訊全螢幕、IndexedDB 配額）尚未在真瀏覽器實測。

## 14. Phase 3 · E：視訊通話（WebRTC，2026-11-22）

### 14.1 架構
- **信令（signaling）**：主要走 Supabase Realtime（Phoenix 協定，直接用 WebSocket，不依賴套件）。每位使用者監聽頻道 `realtime:pma-inbox-<代號>`，送信時加入對方的收件匣頻道並 broadcast。專案順序沿用 `js/config.js` 的備援清單。
- **備援信令**：Realtime 全部連不上時，退回 Cloudflare worker 的 KV 信箱（`POST /signal` 送、`POST /signal/poll` 每 3 秒輪詢）。信箱保留 120 秒、最多 50 則。
- **TURN**：`POST /turn-config`（需登入 token）由 worker 呼叫 Cloudflare Calls 取得短效憑證（TTL 1 小時）。沒有設定 `TURN_KEY_ID` / `TURN_API_TOKEN` 時只回傳 STUN，並標示 `turn:false`，前端會顯示提示。
- **STUN**：`stun:stun.cloudflare.com:3478`。
- **媒體**：RTCPeerConnection 1 對 1；鏡頭切換用 `replaceTrack`，不重新協商。

### 14.2 信令格式（`js/core/call-state.js`，有測試）
`{v:1, callId, from, to, type, payload}`，type ∈ offer / answer / ice / hangup / record-state。
驗證：版本、代號格式、不可打給自己、SDP 必須以 `v=0` 開頭、ICE 與 SDP 有長度上限。

### 14.3 狀態機
idle → calling（我打出）／ringing（來電）→ connected → ended → idle。不合法的事件忽略。

### 14.4 鏡頭
- 手機可切換前後鏡頭（`facingMode: {ideal}`，找不到會退回可用鏡頭）。
- 只有兩顆以上鏡頭時才顯示切換按鈕（`canFlipCamera`，有測試）。

### 14.5 錄製（`js/recorder.js`、`js/recordings.js`）
- 可選純音訊或影像。音訊混合本地與遠端音軌（WebAudio）；影像用 canvas 合成（遠端大畫面、本地小畫面）。
- mimeType 依 `MediaRecorder.isTypeSupported` 依序挑選（有測試）。
- **錄製中顯示紅色 ● REC；開始與停止時透過信令通知對方**（`record-state`），對方畫面顯示「對方正在錄製」。
- **結果不進對話**，存進使用者自己的「錄音錄影庫」：預設 IndexedDB（獨立資料庫 `pma-recordings`，可播放（影像點一下才載入）、改名、刪除、下載）。
- **fap = File System Access API**：可選一個本機資料夾（`showDirectoryPicker`，handle 存 IndexedDB，寫入前重新要求權限）。不支援的瀏覽器（多數手機）隱藏此功能，改用下載。

### 14.6 已知限制（誠實記載）
- **信令沒有防偽造**：Realtime 頻道目前用公開的 publishable 金鑰即可訂閱，任何人可以偽造 `from` 送出假來電。緩解方式：在 Supabase 啟用 Realtime 私有頻道與 RLS 政策（需使用者在後台設定，未做）；worker 信箱路徑已驗證 `from` 必須等於登入代號。
- 未在真實瀏覽器（兩台裝置、手機鏡頭、NAT 穿透）實測。
- 只有 1 對 1；群組通話（mesh）未做。螢幕分享未做。
- 錄製在瀏覽器記憶體中進行，長時間錄影會佔用大量記憶體。

## 15. Phase 3 · F：備份與每日壓縮

### 15.1 帳號路徑
歸檔改為 `accounts/<代號>/YYYY-MM/...`（代號來自登入 token，不來自請求，所以使用者無法寫入他人的資料夾）。worker 的 `accountPath()` 有測試。

### 15.2 備份（`js/backup.js`、`js/core/zip.js`）
- 匯出：zip，內含 `manifest.json`、`messages.jsonl`、`attachments/<訊息 id>/<檔名>`。
- 還原：讀 zip，依 id 寫入 IndexedDB（同 id 覆蓋，不會重複）。
- 每日自動上傳：登入後若距上次超過 24 小時，把備份上傳為 `accounts/<代號>/YYYY-MM/docs/backup-YYYYMMDD.zip`（走既有附件路徑，超過 20MB 會切片）。
- zip 只用 store（不壓縮），由 `zip.test.mjs` 驗證 CRC32 與往返；另已用 .NET `ZipFile` 驗證可被標準工具讀取。

### 15.3 每日壓縮（`cloudflare/archive-worker/squash.js`、`worker.js` 的 `squashArchive`）
- 觸發：Cron Trigger `0 19 * * *`（UTC，即 UTC+8 凌晨 03:00）。
- 做法：取得 branch 的 head；列出所有 commit（分頁，最多 2000 筆）；**最舊的 commit（base）永遠不動**；若 base 之後不到 2 筆就跳過。
- 用 Git Data API 建立新 commit：tree = 目前 head 的 tree，parent = base；確認 head 沒變後，`PATCH ref`（`force: true`）。
- 鎖：壓縮前在 KV 寫入 `squash-lock`（TTL 15 分鐘）。鎖存在時，`/append` 與 `/attachment` 回 **503**，前端會保留待補傳並稍後重試，因此上傳不會遺失。
- 紀錄：壓縮後更新根目錄的 `squash-log.json`（保留最近 60 筆）。注意：這是根目錄檔案，不是 manifest（需求原文是「manifest」，這裡為了不與帳號月份 manifest 混淆而另開）。

**誠實說明**：
- force 更新會**改寫歷史**：舊的 commit 不再被 branch 指向。
- GitHub 只有在自己的垃圾回收（GC）之後才會釋放舊物件，所以 repo 的大小**不會立即縮小**。
- 因為壓縮後的 commit tree 就是 head 的 tree，範圍內的內容全部保留；不會丟資料，但舊的逐 commit 歷史會消失。
- 壓縮期間（鎖存在時）上傳會被延後，不是被丟棄。

### 15.4 使用者需要在 Cloudflare 新增的項目（Phase 3 增量）
| 類型 | 名稱 | 說明 |
|---|---|---|
| Secret | `TURN_KEY_ID` | Cloudflare Calls 的 TURN key ID（沒有則只用 STUN） |
| Secret | `TURN_API_TOKEN` | Cloudflare Calls API token（只給 TURN 用） |
| Cron Trigger | `0 19 * * *` | 每日壓縮（在 worker 的 Triggers 設定） |
| KV | 既有 `KV` | 信令信箱與壓縮鎖沿用 |
| Secret | `GH_TOKEN` | 既有；壓縮需要 repo 的 Contents 與 Git Data 寫入權限（fine-grained token 要有 Contents: read/write） |
| Worker | 重新部署 | 本版 worker 新增了 `video` 分類、帳號路徑、壓縮與 TURN 路由 |

注意：既有的歸檔檔案仍在舊路徑（`YYYY-MM/...`），新版寫入 `accounts/...`。若需要，請自行搬移舊資料。
