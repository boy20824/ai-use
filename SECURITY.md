# 安全基線

這份清單對應目前的服務與畫面。正式密鑰只放在環境變數，`.env.example` 只有示範預設值。

| 控制                   | 作法                                                                                                                     | 如何測試                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Helmet 與嚴格 CSP      | `@fastify/helmet`，`default-src 'none'`、`script-src 'self'`，沒有 `unsafe-inline`                                       | `server/src/security.test.ts` 檢查 `content-security-policy`                   |
| CORS 允許清單          | `CORS_ORIGINS`（或單一的 `CORS_ORIGIN`），不反射未列入的來源                                                             | 同一測試對 `https://evil.example` 確認沒有對應的 `access-control-allow-origin` |
| CSRF                   | `SameSite=Strict` session cookie，再加上雙重提交的 `csrf` cookie 與 `x-csrf-token`；變更請求若帶了來源，必須在允許清單內 | 跨站 `Origin` 與缺少權杖的上傳都應得到 403                                     |
| 登入速率與鎖定         | 同一 IP 每分鐘有次數上限；同一帳號連續失敗達到門檻後鎖定                                                                 | 失敗兩次後正確密碼仍是 429；另測每分鐘上限                                     |
| 階段到期與輪替         | 登入會刪除該使用者舊階段並發出新 cookie；過期階段會被拒絕                                                                | 第二次登入後，第一個 cookie 不能再讀 `/api/auth/me`                            |
| 正式環境 Secure cookie | `NODE_ENV=production` 或 `COOKIE_SECURE=true` 時加上 `Secure`                                                            | `cookieSecureFromEnv` 與 `cookie.secure`                                       |
| 每個路由的輸入結構     | Zod：登入本文、類別名稱／代號／簡述／步驟、範本連結編號、類別查詢、範本編號、上傳的類別欄位                              | SQL 字串與不合法編號得到 400，回應沒有 `stack`                                 |
| 一致的錯誤回應         | `{ error, message }`，錯誤處理不把堆疊送出                                                                               | 鎖定與驗證失敗的 JSON 不含 `stack` 或 `SQLITE`                                 |
| 稽核紀錄               | `audit_log` 記錄範本上傳／刪除，以及類別的 `category_create`、`category_update`、`category_delete`。不記產生文件的欄位   | 檔案內文與填寫步驟正文不會出現在稽核列                                         |
| 檔名與路徑             | 只留檔名，去掉 `..`、斜線、控制字元；不把檔名當路徑                                                                      | `../../etc/passwd.docx` 存成 `passwd.docx`                                     |
| docx zip bomb          | 限制 ZIP 項目數與未壓縮總大小，並拒絕 ZIP 內的 `..` 路徑                                                                 | 超過項目數的 docx 得到 400                                                     |
| 依賴稽核               | `pnpm audit`                                                                                                             | 見下方結果；能修的已升版                                                       |
| 畫面不使用 v-html      | ESLint `vue/no-v-html`，範本名稱先去掉標記字元再以文字節點輸出                                                           | `src/utils/fileName.test.ts`；`pnpm lint`                                      |
| 角色                   | 唯讀不能改類別或範本。承辦可建立、編輯類別與連結、上傳範本，不能刪除。管理員可刪除類別與範本                             | 未授權角色得到 403                                                             |
| 類別與範本生命週期     | 刪除類別只刪除 `category_steps` 與 `category_templates`。刪除範本才刪檔，並由外鍵一併移除連結                            | 刪除類別後範本 blob 仍可下載；刪除範本後連結列為 0                             |
| 不保存案件欄位         | 沒有姓名、日期的資料表欄位；產生文件留在瀏覽器。內建類別與相關文件清單已移除                                             | 範本表與類別表欄位檢查，稽核不含填寫內容                                       |
| 不內建案件類別         | 遷移只刪除固定種子編號。`SEED_SAMPLE_DATA`／`SEED_DEMO_USERS` 僅在非 production 放入示範範本，且不建立類別               | 種子編號消失、自建編號保留；production 旗標不寫入示範範本                      |

登入階段是 httpOnly cookie。CSRF 權杖不是 httpOnly，讓同一個來源的頁面能放進標頭；其他網站讀不到這個 cookie。

## 依賴稽核

`pnpm audit` 在這次變更時沒有已知漏洞。之後若出現公告，先升級能相容的套件，再把仍無法排除的項目記在這裡。
