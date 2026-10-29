# AI 使用管理

前端工作台：選擇案件類別、閱讀相關文件與填寫步驟、上傳 Word 範本，再填入欄位並下載文件。案件送審、分派與結案尚未接上。

畫面說明來自前端示範模組。程式不會對 API 發送請求，也不會用 `v-html`。

## 技術棧

- Vite
- Vue 3
- TypeScript
- Tailwind CSS
- Vue Router
- Pinia
- docxtemplater、PizZip、JSZip
- ESLint 與 Prettier
- pnpm

## 環境

- Node.js 22 或以上
- pnpm 10

## 安裝與啟動

```bash
pnpm install
cp .env.example .env
pnpm dev
```

開發伺服器位址以終端機輸出為準，預設是 `http://localhost:5173`。

## 指令

| 指令                | 作用                                 |
| ------------------- | ------------------------------------ |
| `pnpm dev`          | 啟動開發伺服器                       |
| `pnpm build`        | 執行型別檢查並產出正式建置           |
| `pnpm preview`      | 預覽正式建置                         |
| `pnpm typecheck`    | 只做型別檢查                         |
| `pnpm lint`         | 執行 ESLint，並用 Prettier 檢查格式  |
| `pnpm check:sample` | 用示範範本確認欄位可被帶入並打成 zip |

## 環境變數

`.env.example` 只包含 `VITE_API_BASE_URL`。複製成 `.env` 後可改成本機 API 位址。

程式只判斷這個值是否已填寫，用來在總覽顯示「已讀取」或「未設定」。不會向該位址送出任何請求。

請勿把權杖、密碼或其他密鑰放進這個變數。Vite 會把以 `VITE_` 開頭的變數打包進前端。`.env` 已列入 `.gitignore`。

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

## 登入

登入只在前端比對 `src/data/mockUsers.ts` 的示範帳號。這些密碼不是正式密鑰，也不會送到伺服器。登入狀態只留在目前分頁，重新整理後需要再登入。

正式驗證會在 Phase C/D 改接後端，到時移除此清單。

| 帳號   | 密碼        | 角色       | 可以做的事                             |
| ------ | ----------- | ---------- | -------------------------------------- |
| clerk  | clerk-demo  | 類別承辦   | 上傳與移除範本，並產生文件             |
| admin  | admin-demo  | 系統管理員 | 與承辦相同，並可對照權限               |
| viewer | viewer-demo | 唯讀檢視   | 閱讀類別與範本，可產生文件但不能改範本 |

## 範本與產生文件

範本是每個案件類別的 Word 檔（`.docx`）。在檔案裡用雙大括號標示欄位，例如 `{{姓名}}`、`{{日期}}`。

- 儲存介面是 `TemplateRepository`（`src/storage/templateRepository.ts`）。目前的實作把檔案放在瀏覽器 IndexedDB，所以重新整理不會遺失。Phase C 可以換成後端實作，呼叫端不用改。
- 第一次進入時會放入 `public/samples/field-note.docx`，屬於「一般業務輔助」。刪除後不會自動加回。
- 產生文件時會套用該類別的每一份範本，可單獨下載或打包成 zip。填入的姓名、日期與其他欄位只存在該畫面，離開或重新整理後清除，不會寫入 IndexedDB 或其他儲存。

## 目錄

```text
src/
  components/    共用介面元件
  config/        應用名稱與環境變數讀取
  data/          示範類別、角色與帳號
  services/      範本欄位與文件產生
  storage/       範本儲存介面與 IndexedDB 實作
  layouts/       深色側邊欄與上方列
  router/        路由與登入守衛
  stores/        Pinia 狀態
  views/         各路由頁面
public/samples/  可測試的虛構 .docx 範本
```

## 範圍

- 沒有後端、沒有登入 API、沒有真實權限判斷。
- 沒有案件紀錄或人員名冊。類別與說明文件都是虛構資料。
- 沒有使用 `v-html`。
- 沒有正式密鑰、連線字串或私人憑證。示範密碼只供這個前端階段使用。
