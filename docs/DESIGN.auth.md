# DESIGN.auth — 帳號、登入與金鑰放置（Phase 2 · A）

## 0. 原則

- **金鑰不進公開頁面、不進 repo。** GitHub Pages 的原始碼是公開的，任何會寫進前端的字串都等於公開。
- `GH_TOKEN`（寫 GitHub 私有 repo 的權限）與 `SESSION_SECRET`（簽章密鑰）只存在 Cloudflare Worker 的 secrets。
- 使用者想要的是「留一個後台放這類密碼」，所以密碼與密鑰都在 Worker 後台設定；頁面只拿到**短效的登入 token**。
- 舊的 `ARCHIVE_KEY`（前端用的共享密鑰）**廢止**：它等於把密碼放到前端，不再使用。

## 1. 帳號

- 帳號是「代號」（code）：3–32 個字元，只允許 `a-z 0-9 _ -`（小寫，統一轉小寫）。
- 註冊：代號 + 密碼 + 人機驗證（選填）。**開放註冊**（預設），不需要邀請碼；防濫用見第 7 節。
- **註冊模式**：Worker 變數 `REGISTRATION_MODE`，`open`（預設）／`invite`（沿用 `INVITE_CODE` 邀請碼）／`closed`（暫停註冊）。
- 密碼最少 8 字元。

### 1.1 密碼雜湊

- PBKDF2-SHA256，100,000 次（Cloudflare Workers WebCrypto 的上限內），隨機 16-byte salt。
- 儲存：`{ v:1, iter, salt(b64), hash(b64) }`。比對用常數時間比較。

### 1.2 防暴力

- 同一代號連續失敗 8 次 → 鎖 15 分鐘（記在帳號紀錄裡）。
- 鎖定期間回 429，不做密碼比對。

## 2. 短效 token

- 格式：`base64url(payloadJSON) + "." + base64url(HMAC-SHA256(SESSION_SECRET, payloadB64))`。
- payload：`{ sub: 代號, iat, exp }`，有效 **2 小時**（`exp = iat + 7200`）。
- 驗證：先驗簽章（常數時間），再驗 `exp > now`。
- 前端只把 token 放在記憶體（不寫入 localStorage），重新整理後要重新登入。
- 沒有 refresh token；到期重新登入。

## 3. 路由（Worker）

| 方法 | 路徑 | 認證 | 說明 |
|---|---|---|---|
| GET | `/` | 無 | 健康檢查 |
| POST | `/register` | 無（開放註冊；有防濫用，見第 7 節） | `{code, password, turnstile?}` → 建立帳號 |
| POST | `/login` | 無（有防暴力） | `{code, password}` → `{token, exp}` |
| POST | `/append` | Bearer token | 寫入 JSONL |
| POST | `/attachment` | Bearer token | 寫入附件 part |
| GET | `/manifest` | Bearer token | 讀 manifest |

- 舊的 `X-Archive-Key` 標頭不再接受。
- 所有寫入都由 token 的 `sub` 決定身分；寫入的訊息 `from` 欄位必須等於 `sub`（伺服器覆寫，避免冒充）。

## 4. 資料位置

- **Cloudflare KV**（binding `KV`）：帳號紀錄 `acct:<code>`、之後的使用者設定文件 `prof:<code>`（C 階段）。
- **GitHub 私有 repo**：只放訊息與附件（路徑 B）。帳號與密碼雜湊**不**進 repo。
- **Supabase**：仍是路徑 A 的訊息表（與帳號無關，之後看需要再接）。

## 5. 使用者需要在 Cloudflare 新增的項目

| 類型 | 名稱 | 內容 |
|---|---|---|
| KV binding | `KV` | 新建一個 KV namespace（例如 `pma-kv`），綁定名稱必須是 `KV` |
| Secret | `SESSION_SECRET` | 隨機長字串（≥ 32 bytes），用來簽 token |
| Secret | `TURNSTILE_SECRET` | 選填：Cloudflare Turnstile 的 secret；設定後註冊必須通過人機驗證 |
| Secret | `INVITE_CODE` | 只在 `REGISTRATION_MODE=invite` 時需要 |
| Variable | `REGISTRATION_MODE` | 選填：`open`（預設）／`invite`／`closed` |
| Secret | `GH_TOKEN` | 已設定 |
| Secret | `ARCHIVE_KEY` | **可刪除**（已不使用） |
| Variable | `ARCHIVE_REPO`、`ARCHIVE_BRANCH` | 已設定 |

## 6. 安全注意

- token 外洩最多 2 小時內可寫入你的歸檔；換 `SESSION_SECRET` 會讓所有 token 立即失效。
- 開放註冊時任何人都能建立帳號；因此要靠第 7 節的防線，且隨時可以用 `REGISTRATION_MODE=closed` 關掉。
- 歸檔寫入量大時 GitHub 可能回 409，Worker 會重試。
- 本設計沒有做郵件驗證或二次驗證；這是私人通訊用途的取捨。

## 7. 開放註冊與防濫用（2026-11-22）

### 7.1 風險
開放註冊後，任何人都能建立帳號，而帳號可以寫入我們的私有 repo（經由歸檔路徑）。因此必須有防線，避免：
- 大量自動註冊（機器人）；
- 單一帳號塞爆 repo、耗盡 GitHub API 配額；
- 冒充系統或管理者的代號。

### 7.2 註冊模式（`REGISTRATION_MODE`）
| 值 | 行為 |
|---|---|
| `open`（預設） | 開放註冊，不需邀請碼 |
| `invite` | 需要 `INVITE_CODE`，註冊時要帶正確的邀請碼（舊行為） |
| `closed` | 暫停註冊（回 403）。未知的值也視為 `closed`（寧可拒絕） |

要關掉註冊：把 `REGISTRATION_MODE` 設成 `closed` 並重新部署（不影響已註冊帳號登入）。

### 7.3 防線
| 防線 | 內容 | 實作 |
|---|---|---|
| (a) IP 註冊頻率 | 每個 IP 每小時最多 5 次、每天最多 10 次（失敗的嘗試也計入，防止暴力試代號）。IP 取自 `CF-Connecting-IP`，拿不到時共用 `unknown` 桶 | KV 鍵 `rl:reg:h/d:<ip>:<時間桶>`，`abuse.js` |
| (b) Turnstile（選填） | 設定 `TURNSTILE_SECRET` 後，註冊必須帶 Turnstile token，worker 向 Cloudflare siteverify 驗證；前端的 sitekey（`TURNSTILE_SITEKEY`）是公開值 | `verifyTurnstile()`；沒有 secret 時略過 |
| (c) 帳號配額 | 每個帳號：每日 `/append` 最多 2000 次；每日附件 part 最多 1000 次；每月歸檔總量最多 200MB；單一檔案宣告大小最多 100MB。超過回 429 或 413 | KV 鍵 `q:day/month:<代號>:…`，`checkDailyAppend` / `checkAttachmentQuota` |
| (d) 代號與密碼 | 保留字（admin、root、support…）不可註冊；代號 3–32 字元；密碼至少 8 字元、最多 200 | `RESERVED_CODES`、`validCode`、`validPassword` |
| (e) 登入失敗鎖定 | 連續失敗 8 次鎖 15 分鐘（既有機制） | `loginGate` |

### 7.4 誠實的限制
- 配額與頻率是用 KV 計數，KV 的讀寫不是交易式（atomic），高併發時計數可能略少；作為「防止誤用與大部分濫用」足夠，不是精準計費。
- IP 限制對共用 IP（學校、公司、行動網路 CGNAT）可能誤傷；這是常見的取捨。
- 沒有電子郵件驗證。要防大量帳號，建議同時開 Turnstile。
- 配額只限制歸檔（寫入 repo）的量；登入與註冊本身仍會消耗 Worker 請求額度。
- Turnstile 失敗（網路）時註冊會被拒絕，這是刻意的：寧可讓使用者稍後重試。
