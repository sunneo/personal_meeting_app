// 設定。publishable 金鑰設計上可公開（與 desktop-app 的 fa-worker 相同）。
// 順序即備援順序：主要 → 備援 → 備援2 → 備援3。每個專案都必須執行 supabase/pma.sql。
// 各專案資料互相獨立；長期歸檔以 Cloudflare 歸檔為準（見 docs/DESIGN.md）。
export const SUPABASE_PROJECTS = [
  { name: '主要', url: 'https://schvtbxufjwkibnfgbay.supabase.co', key: 'sb_publishable_Y4hgmYhipEf2S-rS-v45rg_R1Gg-dZe' },
  { name: '備援', url: 'https://wxxovxvasgwqnchwxbxo.supabase.co', key: 'sb_publishable_5YoJVSApOHEsEcKXi3vwxQ_MWzvhh9q' },
  { name: '備援2', url: 'https://kvnnjlbtitvkxfanutup.supabase.co', key: 'sb_publishable_XA9f-Y5ZcIbk-mVzTdcb-A_AMhPwbA_' },
  { name: '備援3', url: 'https://wwpiriwfmmpmtckenqjo.supabase.co', key: 'sb_publishable_MeHx1Qjhu6IV-rp6LvMS7g_Hwp-jUTp' },
];

// 相容舊設定：指向第一個（主要）專案。
export const SUPABASE_URL = SUPABASE_PROJECTS[0].url;
export const SUPABASE_PUBLISHABLE_KEY = SUPABASE_PROJECTS[0].key;

// 長期路徑 B（Cloudflare Worker）的網址，之後才會用到。
export const ARCHIVE_WORKER_URL = '';
