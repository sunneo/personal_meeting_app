// 設定（不含秘密）。部署者要自己填寫，之後不要把真實金鑰 commit 進 repo 以外的地方。
// Supabase：與 desktop-app 共用同一個專案時，把它的網址與 publishable 金鑰貼在這裡（publishable 金鑰本身可公開，但仍建議不要 commit 這個檔案的實際值）。
// 與 desktop-app 共用「主要」專案（取自 desktop-app/cloudflare/fa-worker/worker.js）。publishable 金鑰設計上可公開。
export const SUPABASE_URL = 'https://schvtbxufjwkibnfgbay.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_Y4hgmYhipEf2S-rS-v45rg_R1Gg-dZe';

// 長期路徑 B（Cloudflare Worker）的網址，之後才會用到。
export const ARCHIVE_WORKER_URL = '';
