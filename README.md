# AI 使用管理

Phase A 前端骨架。這個階段提供可建置的 Vue 3 應用程式殼層：側邊欄、上方列，以及總覽、案件、人員、存取與登入五個佔位路由。

畫面資料全部來自前端示範模組，不會對 API 發送請求，也不會保存帳號、密碼或權杖。

## 技術棧

- Vite
- Vue 3
- TypeScript
- Tailwind CSS
- Vue Router
- Pinia
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

| 指令             | 作用                                |
| ---------------- | ----------------------------------- |
| `pnpm dev`       | 啟動開發伺服器                      |
| `pnpm build`     | 執行型別檢查並產出正式建置          |
| `pnpm preview`   | 預覽正式建置                        |
| `pnpm typecheck` | 只做型別檢查                        |
| `pnpm lint`      | 執行 ESLint，並用 Prettier 檢查格式 |

## 環境變數

`.env.example` 只包含 `VITE_API_BASE_URL`。複製成 `.env` 後可改成本機 API 位址。

Phase A 只判斷這個值是否已填寫，用來在畫面上顯示「已設定」或「未設定」。程式不會向該位址送出任何請求。

請勿把權杖、密碼或其他密鑰放進這個變數。Vite 會把以 `VITE_` 開頭的變數打包進前端。`.env` 已列入 `.gitignore`。

## 路由

| 路徑         | 頁面     |
| ------------ | -------- |
| `/`          | 總覽     |
| `/cases`     | 案件     |
| `/personnel` | 人員     |
| `/access`    | 存取權限 |
| `/login`     | 登入佔位 |

`/login` 不驗證身分。表單只接受顯示名稱，並記在目前分頁的記憶體中；重新整理後即消失。沒有密碼欄位。

## 目錄

```text
src/
  components/    共用介面元件
  config/        應用名稱與環境變數讀取
  data/mock.ts   示範資料（唯一資料來源）
  layouts/       側邊欄與上方列
  router/        路由
  stores/        Pinia 狀態
  views/         各路由頁面
```

## 範圍

- 沒有後端、沒有登入 API、沒有真實權限判斷。
- 沒有使用 `v-html`，畫面文字都以文字節點輸出。
- 沒有密鑰、連線字串或私人憑證。
