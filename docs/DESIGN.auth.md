# DESIGN.auth — 帳號、登入與金鑰放置（Phase 2 · A）

## 0. 原則

- **金鑰不進公開頁面、不進 repo。** GitHub Pages 的原始碼是公開的，任何會寫進前端的字串都等於公開。
- `GH_TOKEN`（寫 GitHub 私有 repo 的權限）與 `SESSION_SECRET`（簽章密鑰）只存在 Cloudflare Worker 的 secrets。
- 使用者想要的是「留一個後台放這類密碼」，所以密碼與密鑰都在 Worker 後台設定；頁面只拿到**短效的登入 token**。
- 舊的 `ARCHIVE_KEY`（前端用的共享密鑰）**廢止**：它等於把密碼放到前端，不再使用。

## 1. 帳號

- 帳號是「代號」（code）：3–32 個字元，只允許 `a-z 0-9 _ -`（小寫，統一轉小寫）。
- 註冊：代號 + 密碼 + 邀請碼。密碼「確認」由前端檢查兩次輸入一致；伺服器只收一次密碼。
- **邀請碼**：註冊需要 Worker secret `INVITE_CODE`。否則任何人都能註冊、拿到寫入 repo 的權限。未設定 `INVITE_CODE` 時 `/register` 直接拒絕。
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
| POST | `/register` | 邀請碼（body） | `{code, password, invite}` → 建立帳號 |
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
| Secret | `INVITE_CODE` | 註冊用的邀請碼（自己決定） |
| Secret | `GH_TOKEN` | 已設定 |
| Secret | `ARCHIVE_KEY` | **可刪除**（已不使用） |
| Variable | `ARCHIVE_REPO`、`ARCHIVE_BRANCH` | 已設定 |

## 6. 安全注意

- token 外洩最多 2 小時內可寫入你的歸檔；換 `SESSION_SECRET` 會讓所有 token 立即失效。
- 邀請碼外洩 → 任何人可註冊；換 `INVITE_CODE` 即可（已註冊的帳號不受影響）。
- 歸檔寫入量大時 GitHub 可能回 409，Worker 會重試。
- 本設計沒有做郵件驗證或二次驗證；這是私人通訊用途的取捨。
