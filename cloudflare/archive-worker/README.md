# archive-worker：長期儲存路徑 B（含帳號登入）

把訊息與附件寫進 GitHub 私有 repo `sunneo/personal_meeting_app_repo` 的分支（預設 `archive`）。
與 desktop-app 的 `fa-worker` 是**不同**的 Worker（不改動它），共用同一個 Cloudflare 帳號。
認證設計見 [docs/DESIGN.auth.md](../../docs/DESIGN.auth.md)。

**金鑰與密碼只放在這個 Worker 的 secrets 裡，不放進頁面或 repo。** 前端只拿到 2 小時有效的登入 token。

## 版面

```
YYYY-MM/conversation.jsonl   本月訊息，一行一則
YYYY-MM/manifest.json        本月附件清單
YYYY-MM/<category>/<name>    附件（audio、music、pdf、docs、voice、other）
YYYY-MM/<category>/<name>.part001…   超過 20MB 的附件切片
```

月份以 UTC+8 切分。

## 端點

| 方法 | 路徑 | 認證 | 內容 |
|---|---|---|---|
| GET | `/` | 無 | 健康檢查 |
| POST | `/register` | 無（開放註冊；防濫用見 docs/DESIGN.auth.md 第 7 節） | `{code, password, turnstile?}` 建立帳號 |
| POST | `/login` | 無（有防暴力：8 次失敗鎖 15 分鐘） | `{code, password}` → `{token, exp, code}` |
| POST | `/append` | `Authorization: Bearer <token>` | 寫入訊息（`from` 會被改成登入的代號） |
| POST | `/attachment` | Bearer | `{month, category, name, index, total, data(base64), sha256?, size?}`，單一 part ≤ 20MB |
| GET | `/manifest?month=YYYY-MM` | Bearer | 讀取本月 manifest |

## Cloudflare 需要新增的項目（使用者自己做）

| 類型 | 名稱 | 說明 |
|---|---|---|
| **KV binding** | `KV` | 先建立 KV namespace（例如 `pma-kv`），綁定名稱必須是 `KV`。用來存帳號紀錄。 |
| Secret | `SESSION_SECRET` | 隨機字串，**至少 32 字元**，例如用密碼產生器產生 64 字元。簽 token 用。 |
| Variable | `REGISTRATION_MODE` | 選填：`open`（預設，開放註冊）／`invite`（需要 `INVITE_CODE`）／`closed`（暫停註冊） |
| Secret | `TURNSTILE_SECRET` | 選填：Cloudflare Turnstile 的 secret；設定後註冊需要人機驗證（前端 sitekey 寫在 `js/config.js` 的 `TURNSTILE_SITEKEY`，是公開值） |
| Secret | `INVITE_CODE` | 只在 `REGISTRATION_MODE=invite` 時需要 |
| Secret | `GH_TOKEN` | 已設定：寫 repo 用的 fine-grained token。 |
| Variable | `ARCHIVE_REPO`、`ARCHIVE_BRANCH` | 已設定。 |
| Secret | `ARCHIVE_KEY` | **可以刪除**。新版不再使用。 |

## 部署（Cloudflare 後台網頁）

1. **建議：上傳單檔 `worker.bundle.js`**（已包含所有模組，由 `node scripts/bundle-worker.mjs` 產生）：Workers & Pages → 你的 Worker → Edit code → 整份貼上 → Deploy。不需要另外上傳 `auth.js` 等檔案。若用 wrangler，則部署 `worker.js`（它會打包相依模組）。
2. Settings → Bindings → Add → KV namespace，變數名稱 `KV`。
3. Settings → Variables and Secrets → 新增 Secret：`SESSION_SECRET`（必要）；選填 `TURNSTILE_SECRET`。變數 `REGISTRATION_MODE` 預設 `open`，不需要設定。
4. 驗證：`GET /` 應回 `{"ok":true,"service":"archive-worker"}`。
5. 建立第一個帳號（用 curl 或之後的前端）：
   ```
   POST /register  {"code":"alice","password":"至少8字元"}   （開放註冊；設定 TURNSTILE_SECRET 時要多帶 turnstile 欄位）
   ```

用 wrangler（有 Node 22 時）：`npx wrangler deploy`，並 `npx wrangler secret put SESSION_SECRET` 等。

## 安全注意

- token 有效 2 小時；換 `SESSION_SECRET` 會讓所有 token 立即失效。
- 開放註冊時任何人都能建立帳號。防線：每 IP 每小時 5 次、每天 10 次註冊；每帳號每日 /append 2000 次、每月歸檔 200MB、單檔 100MB；保留字不可註冊。要暫停註冊把 `REGISTRATION_MODE` 設成 `closed`。
- 這個 Worker 只新增與更新檔案，不刪除。
- 不要把 `GH_TOKEN`、`SESSION_SECRET`、`TURNSTILE_SECRET`、`INVITE_CODE` 寫進 repo 任何檔案。
