# personal_meeting_app

靜態網頁通訊軟體（GitHub Pages）：https://sunneo.github.io/personal_meeting_app/

- 文字聊天，每個文字泡泡都能朗讀（Web Speech API）
- 傳送聲音、音樂、PDF（內嵌檢視）、其他文件（下載）
- 麥克風語音訊息，下方列出即時字幕（Web Speech API，不支援時可手動補字幕）
- 短期訊息存在 IndexedDB，並請求持久儲存（`navigator.storage.persist()`）
- 長期訊息兩條路徑：
  - A：Supabase（與 desktop-app 共用專案，見 `supabase/pma.sql`）
  - B：Cloudflare Worker 寫入私有 repo 的分支，逐月 `conversation.jsonl` + `manifest.json`，附件依分類，超過 20MB 切片（見 `cloudflare/archive-worker/README.md`）

設計文件：[docs/DESIGN.md](docs/DESIGN.md)

## 結構

```
index.html                       頁面
css/style.css                    樣式（支援深色模式）
js/app.js                        入口：聊天、檔案、語音
js/store.js                      IndexedDB 短期儲存
js/supabase-store.js             長期路徑 A（Supabase REST RPC）
js/config.js                     設定（網址與公開金鑰留空，由部署者填）
js/core/archive-format.js        純邏輯：月份、切片、JSONL（給前端與測試用）
cloudflare/archive-worker/       長期路徑 B 的 Worker 與部署說明
supabase/pma.sql                 Supabase 資料表與函式（使用者自己執行）
test/                            純邏輯測試
docs/                            設計與交接文件
```

沒有建置步驟，也沒有執行期相依套件。直接用靜態伺服器打開 `index.html` 即可（ES modules 需要 http，不能用 `file://`）。

## 本地測試

需要 Node.js（測試在 Node 16 以上可執行）：

```powershell
npm test
```

## 部署前要做的事（由使用者執行）

1. **Supabase**：在共用專案的 SQL Editor 執行 `supabase/pma.sql`。
2. **備援專案**：`js/config.js` 的 `SUPABASE_PROJECTS` 目前列了四個專案（主要、備援、備援2、備援3，與 desktop-app 的 fa-worker 相同）。**每一個專案都必須在 SQL Editor 執行一次 `supabase/pma.sql`**，否則該專案回 404，程式會換下一個並在狀態列提示。各專案的資料互相獨立；長期歸檔以 Cloudflare 歸檔為準。publishable 金鑰設計上可公開。
   - 備援順序：先試記住的專案（localStorage）；超時 8 秒、網路錯誤、5xx 或 404 就換下一個；每 10 分鐘回頭試主要。
   - 全部失敗時訊息仍留在 IndexedDB，並標示「⏳待補傳」，啟動時、每分鐘與網路恢復時會自動補傳。
3. **Cloudflare 長期路徑 B**：依 `cloudflare/archive-worker/README.md` 部署 Worker，設定 secrets `GH_TOKEN` 與 `ARCHIVE_KEY`。
4. **GitHub Pages**：repo 設定中啟用 `main` 分支的 Pages。

目前還沒做的：把附件寫入路徑 B 的 UI 流程（Worker 端點已備妥）、從 Supabase 拉回歷史訊息，以及 `js/config.js` 內的 Worker 網址串接。

## 安全

- repo 內不放任何 token、私鑰或真實的 `ARCHIVE_KEY`。
- `GH_TOKEN` 只存在 Cloudflare Worker 的 secrets，權限限定在私有 repo 的 Contents 讀寫。
