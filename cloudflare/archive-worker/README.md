# archive-worker：長期儲存路徑 B

把訊息與附件寫進 GitHub 私有 repo `sunneo/personal_meeting_app_repo` 的分支（預設 `archive`）。
與 desktop-app 的 `fa-worker` 是**不同**的 Worker（不改動它）；兩者共用同一個 Cloudflare 帳號。

## 版面

```
YYYY-MM/conversation.jsonl   本月訊息，一行一則
YYYY-MM/manifest.json        本月附件清單
YYYY-MM/<category>/<name>    附件（category：audio、music、pdf、docs、voice、other）
YYYY-MM/<category>/<name>.part001…   超過 20MB 的附件切片
```

月份以 UTC+8 切分。

## 端點

| 方法 | 路徑 | 內容 |
|---|---|---|
| GET | `/` | 健康檢查（不需要密鑰） |
| POST | `/append` | 一則訊息的 JSON，寫入對應月份的 `conversation.jsonl` |
| POST | `/attachment` | `{month, category, name, index, total, data(base64), sha256?, size?}`，單一 part ≤ 20MB；最後一份會更新 manifest |
| GET | `/manifest?month=YYYY-MM` | 讀取本月 manifest |

所有寫入端點都要帶標頭 `X-Archive-Key: <ARCHIVE_KEY>`。

## 部署（使用者自己做；不在 repo 內執行）

1. **GitHub**：建立私有 repo `personal_meeting_app_repo`（若還沒有）並建立分支 `archive`。
2. **GitHub token**：Settings → Developer settings → Fine-grained tokens，只選該 repo，權限 **Contents：Read and write**。
3. **Cloudflare 後台（不需安裝任何東西）**：Workers & Pages → Create → Worker → 名稱 `personal-meeting-archive` → Edit code，貼上 `worker.js` 全部內容 → Deploy。
4. **變數**：Settings → Variables，新增 `ARCHIVE_REPO`＝`sunneo/personal_meeting_app_repo`、`ARCHIVE_BRANCH`＝`archive`。
5. **秘密**：Settings → Variables and Secrets，新增類型 **Secret**：`GH_TOKEN`（步驟 2 的 token）與 `ARCHIVE_KEY`（自己隨機產生一串長字串）。
6. **驗證**：打開 Worker 網址，應看到 `{"ok":true,"service":"archive-worker"}`。
7. 把 Worker 網址填進前端 `js/config.js` 的 `ARCHIVE_WORKER_URL`，並把 `ARCHIVE_KEY` 的值交給前端（前端的密鑰是共享密鑰，只擋陌生人；不要把它 commit 進 repo）。

用 wrangler（有安裝 Node 22 時）：`npx wrangler deploy`，然後 `npx wrangler secret put GH_TOKEN`、`npx wrangler secret put ARCHIVE_KEY`。

## 注意

- 這個 Worker 只新增與更新檔案，不刪除。
- 同一檔案短時間大量寫入時，GitHub 可能回 409，Worker 會重試（最多 4 次）。
- GitHub Contents API 單檔上限約 100MB；每份 part 最大 20MB，base64 後約 27MB，符合限制。
- 不要把 `GH_TOKEN` 或 `ARCHIVE_KEY` 寫進 repo 任何檔案。
