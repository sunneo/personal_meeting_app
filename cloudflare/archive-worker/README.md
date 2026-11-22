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
| POST | `/register` | 邀請碼（body `invite`） | `{code, password, invite}` 建立帳號 |
| POST | `/login` | 無（有防暴力：8 次失敗鎖 15 分鐘） | `{code, password}` → `{token, exp, code}` |
| POST | `/append` | `Authorization: Bearer <token>` | 寫入訊息（`from` 會被改成登入的代號） |
| POST | `/attachment` | Bearer | `{month, category, name, index, total, data(base64), sha256?, size?}`，單一 part ≤ 20MB |
| GET | `/manifest?month=YYYY-MM` | Bearer | 讀取本月 manifest |

## Cloudflare 需要新增的項目（使用者自己做）

| 類型 | 名稱 | 說明 |
|---|---|---|
| **KV binding** | `KV` | 先建立 KV namespace（例如 `pma-kv`），綁定名稱必須是 `KV`。用來存帳號紀錄。 |
| Secret | `SESSION_SECRET` | 隨機字串，**至少 32 字元**，例如用密碼產生器產生 64 字元。簽 token 用。 |
| Secret | `INVITE_CODE` | 註冊用的邀請碼（自己決定）。沒設定就無法註冊。 |
| Secret | `GH_TOKEN` | 已設定：寫 repo 用的 fine-grained token。 |
| Variable | `ARCHIVE_REPO`、`ARCHIVE_BRANCH` | 已設定。 |
| Secret | `ARCHIVE_KEY` | **可以刪除**。新版不再使用。 |

## 部署（Cloudflare 後台網頁）

1. 上傳新版 `worker.js` 與 `auth.js`：Workers & Pages → 你的 Worker → Edit code。`worker.js` 用 `import ... from './auth.js'`，所以兩個檔案都要放進 Worker（在後台新增 `auth.js` 檔案）。若只能貼單一檔，請用 wrangler 部署（它會打包）。
2. Settings → Bindings → Add → KV namespace，變數名稱 `KV`。
3. Settings → Variables and Secrets → 新增 Secret：`SESSION_SECRET`、`INVITE_CODE`。
4. 驗證：`GET /` 應回 `{"ok":true,"service":"archive-worker"}`。
5. 建立第一個帳號（用 curl 或之後的前端）：
   ```
   POST /register  {"code":"alice","password":"至少8字元","invite":"你設定的 INVITE_CODE"}
   ```

用 wrangler（有 Node 22 時）：`npx wrangler deploy`，並 `npx wrangler secret put SESSION_SECRET` 等。

## 安全注意

- token 有效 2 小時；換 `SESSION_SECRET` 會讓所有 token 立即失效。
- 邀請碼外洩 → 別人可以註冊；換 `INVITE_CODE` 即可（已註冊的帳號不受影響）。
- 這個 Worker 只新增與更新檔案，不刪除。
- 不要把 `GH_TOKEN`、`SESSION_SECRET`、`INVITE_CODE` 寫進 repo 任何檔案。
