# AI 使用管理

選擇案件類別、閱讀相關文件與填寫步驟、上傳 Word 範本，再以民國日期填入欄位並下載文件。案件送審、分派與結案尚未接上。產生文件留在瀏覽器，不會把姓名或日期存進服務。

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

第一次啟動會建立 SQLite、寫入示範帳號，並放入 `public/samples/field-note.docx`。

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

`VITE_` 變數會進前端。請不要把正式密鑰放進去。`VITE_TEMPLATE_STORAGE=api` 時範本存在服務；改成 `indexeddb` 時範本只留在這個瀏覽器，登入仍走服務。

`DATABASE_PATH` 與 `UPLOAD_DIR` 在開發時相對 `server/`。`SESSION_SECRET` 用來簽署 session cookie；正式環境少了它，或仍是 `.env.example` 的示範值，服務會拒絕啟動。

預設示範帳號（密碼以 `.env.example` 為準）：

| 帳號   | 角色       | 可以做的事                   |
| ------ | ---------- | ---------------------------- |
| clerk  | 類別承辦   | 上傳範本、產生文件，不能移除 |
| admin  | 系統管理員 | 上傳與移除範本，並可對照權限 |
| viewer | 唯讀檢視   | 閱讀與產生文件，不能改範本   |

登入使用 httpOnly、`SameSite=Strict` 的階段 cookie。重新整理後會向 `/api/auth/me` 恢復身分。

## 部署

正式環境由 Fastify 在同一個來源提供建置後的畫面與 `/api`。Fly.io 的指令、volume、機密與費用見 [docs/DEPLOY-fly.md](docs/DEPLOY-fly.md)。

## 路由

| 路徑              | 頁面                                   |
| ----------------- | -------------------------------------- |
| `/login`          | 帳號與密碼登入                         |
| `/`               | 總覽                                   |
| `/categories`     | 案件類別                               |
| `/categories/:id` | 類別工作台：文件、步驟、範本、產生文件 |
| `/templates`      | 範本文件                               |
| `/access`         | 角色與權限對照                         |

未登入時，工作台路由會回到 `/login`。`/drafts` 會轉到 `/templates`。`/cases` 與 `/personnel` 會轉到案件類別。

## 日期與範本

日期用民國年。`{{日期}}` 會寫成 `115年10月29日`，`{{日期_民國}}` 會寫成 `115/10/29`。畫面上的日期也以民國年顯示。

範本是每個案件類別的 `.docx`。服務會檢查 MIME、ZIP 檔頭，以及檔案裡是否有 Word 本文。查詢都用參數，不把輸入拼進 SQL。

- 儲存介面是 `TemplateRepository`。預設走 API；`VITE_TEMPLATE_STORAGE=indexeddb` 改回瀏覽器儲存。
- 產生文件在瀏覽器完成。姓名、日期與其他欄位只存在該畫面，離開後清除，服務沒有欄位可以保存它們。

## 目錄

```text
src/             畫面
server/          Fastify 與 SQLite
public/samples/  虛構的 .docx 範本
Dockerfile       正式映像
fly.toml         Fly.io app
```

## 範圍

- 帳號、類別與範本都是虛構示範資料。
- 沒有使用 `v-html`。
- 沒有把正式密鑰寫進程式。
