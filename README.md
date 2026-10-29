# AI 使用管理

建立案件類別、寫下填寫步驟，從共用範本庫選取 Word 範本，再以民國日期填入欄位並下載文件。案件送審、分派與結案尚未接上。產生文件留在瀏覽器，不會把姓名或日期存進服務。

## 技術棧

- Vite、Vue 3、TypeScript、Tailwind CSS、Vue Router、Pinia
- docxtemplater、PizZip、JSZip
- Fastify、better-sqlite3、bcrypt
- Vitest
- ESLint、Prettier、pnpm workspace

## 環境

- Node.js 22 或以上
- pnpm 10

## 安裝與啟動

一條指令同時啟動畫面與服務：

```bash
pnpm install
cp .env.example .env
pnpm dev
```

- 畫面：`http://localhost:5173`（`/api` 會轉到服務）
- 服務：`http://127.0.0.1:3000`

第一次啟動會建立 SQLite。案件類別不會預先建立。`.env.example` 的 `SEED_DEMO_USERS=true` 會寫入尚不存在的示範帳號；正式環境預設不寫入，也不會刪除已存在的使用者。`SEED_SAMPLE_DATA=true` 且不是 production 時，才會放入欄位示範範本。

## 指令

| 指令                | 作用                                 |
| ------------------- | ------------------------------------ |
| `pnpm dev`          | 同時啟動畫面與服務                   |
| `pnpm test`         | 民國日期單元測試與 API 整合測試      |
| `pnpm typecheck`    | 檢查畫面與服務的型別                 |
| `pnpm lint`         | ESLint 與 Prettier                   |
| `pnpm build`        | 建置畫面，並做服務型別檢查           |
| `pnpm check:sample` | 用示範範本確認欄位可被帶入並打成 zip |

## 環境變數

複製 `.env.example` 成 `.env`。示範密碼只放在那裡，程式不寫死預設密碼。`.env` 已列入 `.gitignore`。

`VITE_` 變數會進前端。請不要把正式密鑰放進去。`VITE_TEMPLATE_STORAGE=api` 時範本存在服務；改成 `indexeddb` 時範本只留在這個瀏覽器，登入與案件類別仍走服務。

`SEED_SAMPLE_DATA=true` 或 `SEED_DEMO_USERS=true` 時，開發環境會放一份欄位示範範本到範本庫，不建立案件類別。`NODE_ENV=production` 時這兩個旗標都不會寫入示範範本。

`DATABASE_PATH` 與 `UPLOAD_DIR` 在開發時相對 `server/`。`SESSION_SECRET` 用來簽署 session cookie；正式環境少了它，或仍是 `.env.example` 的示範值，服務會拒絕啟動。

`SEED_DEMO_USERS=true` 時，若資料庫還沒有 `clerk`、`admin`、`viewer`，啟動會建立這三個帳號，密碼來自 `SEED_USER_*`。開發的 `.env.example` 設為 `true`。正式環境請維持未設定或 `false`（`fly.toml` 是 `false`），這樣不需要 `SEED_USER_*` 也能啟動。啟動不會刪除或覆寫已經存在的使用者。

角色只有兩種：系統管理員（`sysadmin`）與一般使用者（`user`）。既有資料庫在啟動時會把 `admin` 改成 `sysadmin`、`clerk` 與 `viewer` 改成 `user`；帳號 `boy20824` 會成為系統管理員。`can_manage_categories` 預設為否，由系統管理員逐一開放。這段遷移可以重複執行，包在交易裡，不會刪除使用者或案件類別。

預設示範帳號（只在有開啟種子時建立，密碼以 `.env.example` 為準）：

| 帳號   | 角色       | 可以做的事                                                                                   |
| ------ | ---------- | -------------------------------------------------------------------------------------------- |
| clerk  | 一般使用者 | 閱讀類別、步驟與範本，並在工作台產生文件。不能維護類別或範本，也不能管理會員                 |
| admin  | 系統管理員 | 維護類別與範本、刪除類別與範本、管理會員，以及處理留言板的狀態與回覆。刪除類別不會刪除範本檔 |
| viewer | 一般使用者 | 與 clerk 相同，用來對照另一個一般使用者                                                      |

任何人都可以在登入頁按「註冊帳號」。註冊只收名稱、暱稱、帳號、密碼與確認密碼，帳號立刻啟用，角色是一般使用者，不能維護類別。註冊端點有每 IP 與全站次數上限。

登入使用 httpOnly、`SameSite=Strict` 的階段 cookie。重新整理後會向 `/api/auth/me` 恢復身分。

## 部署

正式環境由 Fastify 在同一個來源提供建置後的畫面與 `/api`。Fly.io 的指令、volume、機密與費用見 [docs/DEPLOY-fly.md](docs/DEPLOY-fly.md)。

## 路由

| 路徑                   | 頁面                                 |
| ---------------------- | ------------------------------------ |
| `/login`               | 帳號與密碼登入                       |
| `/register`            | 註冊帳號                             |
| `/`                    | 總覽。沒有類別時顯示空狀態與新增按鈕 |
| `/categories`          | 案件類別                             |
| `/categories/new`      | 新增案件類別                         |
| `/categories/:id`      | 類別工作台：以步驟產生文件           |
| `/categories/:id/edit` | 編輯名稱、代號、簡述與填寫步驟       |
| `/templates`           | 範本庫。顯示範本用在哪個類別的步驟   |
| `/feedback`            | 留言板：網頁改善建議                 |
| `/members`             | 會員管理。只有系統管理員             |

未登入時，工作台路由會回到 `/login`。`/categories/new` 與 `/categories/:id/edit` 要有維護類別的權限（系統管理員，或 `can_manage_categories` 的一般使用者）；其他已登入身分會回到案件類別，編輯網址則回到該類別工作台。`/members` 只有系統管理員進得去。`/access` 會轉到 `/members`。`/drafts` 會轉到 `/templates`。`/cases` 與 `/personnel` 會轉到案件類別。

## 日期與範本

日期用民國年。`{{日期}}` 會寫成 `115年10月29日`，`{{日期_民國}}` 會寫成 `115/10/29`。畫面上的日期也以民國年顯示。

範本是全站共用的 `.docx`，不屬於單一類別。每個填寫步驟用 `step_templates(step_id, template_id, sort_order)` 連結範本。步驟有穩定編號。服務會檢查 MIME、ZIP 檔頭，以及檔案裡是否有 Word 本文。查詢都用參數，不把輸入拼進 SQL。

- 儲存介面是 `TemplateRepository`。預設走 API；`VITE_TEMPLATE_STORAGE=indexeddb` 改回瀏覽器儲存。
- 類別編輯頁要有維護類別的權限。可以新增、修改、排序、刪除步驟。每個步驟用「從範本庫選取」搜尋並勾選範本；從該步驟上傳會先存進範本庫再連結到該步驟。刪除類別與刪除範本只有系統管理員可以。
- 工作台預設是直向步驟。第一步固定為「基本資料」，填姓名與民國日期，並帶出範本裡其他 `{{欄位}}`。後續步驟顯示說明與該步驟的範本，「產生」在瀏覽器套用基本資料。所有已登入的使用者都可以產生。欄位只留在記憶體，離開類別或登出即清除，不會送到服務，也不會寫入稽核。
- 工作台第二個分頁是「全部文件總覽」。它列出這個類別所有步驟的範本（同一份只出現一次，預設全勾），可以取消勾選，也可以從範本庫暫時加入其他範本。暫時加入只留在這次畫面，不會改類別設定。已勾選範本的每個 `{{欄位}}` 只問一次，並與步驟頁的基本資料共用。按下「產生勾選文件」會在瀏覽器下載 zip。
- 刪除範本時，若已有步驟連結，確認視窗會列出受影響的類別與步驟，然後解除連結並刪除檔案。刪除類別只移除步驟與連結，不刪範本檔。

既有資料庫在啟動時會遷移：原本掛在類別上的範本改掛到該類別的第一個步驟；若還沒有步驟，會補上「產生文件」。內建類別只依固定編號刪除：`general-assist`、`doc-summary`、`training-material`、`public-copy`、`analysis-pilot`。其他編號的類別會留下。角色會從 `admin` / `clerk` / `viewer` 改成 `sysadmin` / `user`，並補上暱稱、啟用狀態、可維護類別與註冊時間。帳號 `boy20824` 會是系統管理員。

留言板的標題、內容與管理員回覆都是純文字，畫面不用 `v-html`，換行用 CSS 保留。暱稱取自帳號，不接受客戶端自填。會員管理可新增帳號、啟用、停用、切換可維護類別，以及設定或取消系統管理員。不能停用自己，也不能取消自己的系統管理員；至少要留下一位啟用中的系統管理員。停用會立刻刪除該帳號的階段，之後每個已登入請求都會再確認帳號仍啟用。

## 目錄

```text
src/             畫面
server/          Fastify 與 SQLite
public/samples/  虛構的 .docx 範本
Dockerfile       正式映像
fly.toml         Fly.io app
```

## 範圍

- 示範帳號仍會在使用者表是空的時候建立。案件類別改由使用者建立，不再內建。
- 沒有使用 `v-html`。
- 沒有把正式密鑰寫進程式。
