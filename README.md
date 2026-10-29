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

第一次啟動會建立 SQLite 並寫入示範帳號。案件類別不會預先建立。`SEED_SAMPLE_DATA=true` 且不是 production 時，才會放入 `public/samples/field-note.docx`。

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

預設示範帳號（密碼以 `.env.example` 為準）：

| 帳號   | 角色       | 可以做的事                                     |
| ------ | ---------- | ---------------------------------------------- |
| clerk  | 類別承辦   | 建立與編輯類別、上傳範本、調整連結，不能刪除   |
| admin  | 系統管理員 | 另外可以刪除類別與範本。刪除類別不會刪除範本檔 |
| viewer | 唯讀檢視   | 閱讀與產生文件，不能改類別或範本               |

登入使用 httpOnly、`SameSite=Strict` 的階段 cookie。重新整理後會向 `/api/auth/me` 恢復身分。

## 路由

| 路徑                   | 頁面                                 |
| ---------------------- | ------------------------------------ |
| `/login`               | 帳號與密碼登入                       |
| `/`                    | 總覽。沒有類別時顯示空狀態與新增按鈕 |
| `/categories`          | 案件類別                             |
| `/categories/new`      | 新增案件類別                         |
| `/categories/:id`      | 類別工作台：步驟、範本連結、產生文件 |
| `/categories/:id/edit` | 編輯名稱、代號、簡述與填寫步驟       |
| `/templates`           | 範本庫。顯示每份範本被哪些類別使用   |
| `/access`              | 角色與權限對照                       |

未登入時，工作台路由會回到 `/login`。`/drafts` 會轉到 `/templates`。`/cases` 與 `/personnel` 會轉到案件類別。

## 日期與範本

日期用民國年。`{{日期}}` 會寫成 `115年10月29日`，`{{日期_民國}}` 會寫成 `115/10/29`。畫面上的日期也以民國年顯示。

範本是全站共用的 `.docx`，不屬於單一類別。類別用 `category_templates(category_id, template_id, sort_order)` 連結它們，並可調整順序。服務會檢查 MIME、ZIP 檔頭，以及檔案裡是否有 Word 本文。查詢都用參數，不把輸入拼進 SQL。

- 儲存介面是 `TemplateRepository`。預設走 API；`VITE_TEMPLATE_STORAGE=indexeddb` 改回瀏覽器儲存。
- 在類別工作台按「從範本庫選取」可搜尋、勾選、排序連結。從工作台上傳會先存進範本庫再連結到該類別。
- 刪除範本時，若已有類別連結，畫面會列出受影響的類別，確認後解除連結並刪除檔案。刪除類別只移除連結與步驟，不刪範本檔。
- 產生文件在瀏覽器完成，套用該類別連結的每一份範本，可單份下載或打包成 zip。姓名、日期與其他欄位只存在該畫面，離開後清除，服務沒有欄位可以保存它們。

既有資料庫在啟動時會遷移：範本檔保留，原本的類別歸屬改成連結列。內建類別只依固定編號刪除：`general-assist`、`doc-summary`、`training-material`、`public-copy`、`analysis-pilot`。其他編號的類別會留下。

## 目錄

```text
src/             畫面
server/          Fastify 與 SQLite
public/samples/  虛構的 .docx 範本
```

## 範圍

- 示範帳號仍會在使用者表是空的時候建立。案件類別改由使用者建立，不再內建。
- 沒有使用 `v-html`。
- 沒有把正式密鑰寫進程式。
