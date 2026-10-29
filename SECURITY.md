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
| 正式環境階段密鑰       | `SESSION_SECRET` 至少 32 字元，拒絕示範值，並用來簽署 session cookie。種子密碼也不能是 `.env.example` 的示範值           | `server/src/deploy.test.ts`                                                    |
| 同源部署               | 正式環境由同一個來源提供畫面與 `/api`。變更請求的 `Origin` 若等於這個請求的 Host，視為允許                               | 同一測試對 `https://ai-use.fly.dev` 登入，並拒絕 `https://evil.example`        |
| 每個路由的輸入結構     | Zod：登入本文、類別查詢、範本編號、上傳的類別欄位                                                                        | SQL 字串與不合法編號得到 400，回應沒有 `stack`                                 |
| 一致的錯誤回應         | `{ error, message }`，錯誤處理不把堆疊送出                                                                               | 鎖定與驗證失敗的 JSON 不含 `stack` 或 `SQLITE`                                 |
| 稽核紀錄               | `audit_log` 只記誰上傳或刪除了哪份範本與類別                                                                             | 檔案內文的測試字串不會出現在稽核列                                             |
| 檔名與路徑             | 只留檔名，去掉 `..`、斜線、控制字元；不把檔名當路徑                                                                      | `../../etc/passwd.docx` 存成 `passwd.docx`                                     |
| docx zip bomb          | 限制 ZIP 項目數與未壓縮總大小，並拒絕 ZIP 內的 `..` 路徑                                                                 | 超過項目數的 docx 得到 400                                                     |
| 依賴稽核               | `pnpm audit`                                                                                                             | 見下方結果；能修的已升版                                                       |
| 畫面不使用 v-html      | ESLint `vue/no-v-html`，範本名稱先去掉標記字元再以文字節點輸出                                                           | `src/utils/fileName.test.ts`；`pnpm lint`                                      |
| 角色                   | 唯讀不能上傳，承辦不能刪除，管理員可以刪除                                                                               | 未授權角色得到 403                                                             |
| 不保存案件欄位         | 沒有姓名、日期的資料表欄位；產生文件留在瀏覽器                                                                           | 範本表欄位檢查，稽核不含填寫內容                                               |

登入階段是 httpOnly cookie。CSRF 權杖不是 httpOnly，讓同一個來源的頁面能放進標頭；其他網站讀不到這個 cookie。

## 依賴稽核

`pnpm audit` 在這次變更時沒有已知漏洞。之後若出現公告，先升級能相容的套件，再把仍無法排除的項目記在這裡。
