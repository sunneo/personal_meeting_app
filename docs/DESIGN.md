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
2. Cloudflare：建立 `archive-worker`，設定 secrets `GH_TOKEN`、`ARCHIVE_KEY`；把 Worker 網址提供給前端設定。
3. GitHub：建立分支 `archive`（或告訴我名稱）；建立 fine-grained token。
4. GitHub Pages：啟用 `main` 分支的 Pages（若尚未啟用）。
