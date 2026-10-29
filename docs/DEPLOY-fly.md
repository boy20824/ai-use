# 部署到 Fly.io

這個應用是**一個** Fly app。Fastify 同時提供建置後的畫面（含 Vue Router 的 SPA fallback）與 `/api`，瀏覽器只跟同一個來源說話，cookie、CSRF、CORS 不必再為跨站另外設定。SQLite 與上傳的範本檔都放在同一顆 1GB volume，沒有第二台資料庫機器。

正式機密只透過 `fly secrets set` 進入機器，不要寫進 `fly.toml`、Dockerfile 或 git。

## 事前

- 安裝 [flyctl](https://fly.io/docs/flyctl/install/) 並執行 `fly auth login`
- 這個目錄已有 `Dockerfile` 與 `fly.toml`（`primary_region = "nrt"`，東京）
- 若 `app = "ai-use"` 這個名稱已被別人使用，先改 `fly.toml` 裡的 `app`，下面的網址也改成你的名稱

## 建立 app（不要部署）

```bash
fly launch --no-deploy --copy-config
```

`--copy-config` 會沿用現有的 `fly.toml` 與 `Dockerfile`，不會覆寫它們。`--no-deploy` 只建立 app，不發布。若指令詢問組織，選你自己的 org。

## 建立 volume

volume 名稱必須是 `data`，區域必須是 `nrt`，這樣才掛得上 `fly.toml` 的 `[mounts]`。

```bash
fly volumes create data --region nrt --size 1
```

這顆磁碟同時只能掛在**一台**機器上。不要 `fly scale count 2`。SQLite 也不適合兩台機器一起寫。

## 設定機密

`SESSION_SECRET` 至少 32 字元，而且不能是 `dev-only-change-me`、`change-me`、`secret`、`password`、`clerk-demo` 這類示範值。正式環境若沒有這個值，或仍是示範值，程序會拒絕啟動。

三個種子密碼也不能用 `.env.example` 裡的 `clerk-demo`、`admin-demo`、`viewer-demo`。帳號只在資料庫裡**還沒有這個使用者**時建立；之後再啟動不會覆寫已存在的密碼。

`CORS_ORIGINS` 設成對外的 `https://<app 名稱>.fly.dev`。同一個來源的請求即使沒設這項也會被接受；有別的前端來源時再把網址加進這個清單（逗號分隔，不要用 `*`）。

```bash
fly secrets set \
  SESSION_SECRET="$(openssl rand -hex 32)" \
  SEED_USER_CLERK_PASSWORD="換成承辦密碼" \
  SEED_USER_ADMIN_PASSWORD="換成管理員密碼" \
  SEED_USER_VIEWER_PASSWORD="換成唯讀密碼" \
  CORS_ORIGINS="https://ai-use.fly.dev"
```

把最後一行的網域換成你的 app 名稱。這些值不會出現在 git。

## 部署

```bash
fly deploy
```

機器開機時會冪等執行資料庫 migration，並補上缺少的種子使用者、案件類別與示範範本。`GET /healthz` 會對 SQLite 做 `SELECT 1`，回 `{"ok":true}`。Fly 的健康檢查打的是這個路徑。

部署完成後：

```bash
fly status
curl -fsS "https://ai-use.fly.dev/healthz"
```

## 自動停機

`fly.toml` 裡是：

```toml
auto_stop_machines = "stop"
auto_start_machines = true
min_machines_running = 0
```

幾分鐘沒有請求時，Fly Proxy 會把這台機器停掉。停掉之後 CPU 與記憶體不再計費。下一個 HTTP 請求會先把機器啟動（冷啟動通常要數秒，還要加上程式自己的啟動時間），再把請求送進去。`min_machines_running = 0` 表示閒置時可以停到零台，不會為了保活而留一台空轉。

停機時 Fly 送 `SIGTERM`（本機中斷則是 `SIGINT`）。程序會先做 SQLite 的 WAL checkpoint，再關閉資料庫與 HTTP 連線。資料檔在 volume 上，不在容器的暫存層，所以停機、啟動之後還在。

資料庫使用 WAL。同一個目錄裡會有 `app.sqlite`、`app.sqlite-wal`、`app.sqlite-shm`，全部在 `/data`。不要把 `DATABASE_PATH` 指到 `/app` 或其他會隨部署消失的路徑。

| 變數            | 正式環境的值       | 開發時的預設             |
| --------------- | ------------------ | ------------------------ |
| `DATABASE_PATH` | `/data/app.sqlite` | `server/data/app.sqlite` |
| `UPLOAD_DIR`    | `/data/uploads`    | `server/data/uploads`    |
| `NODE_ENV`      | `production`       | `development`            |

`NODE_ENV=production` 時 session cookie 會加上 `Secure`，而且 `HOST` 預設是 `0.0.0.0`，Fly 的 proxy 才連得上。`internal_port` 是 `3000`。

## 備份

Fly 會依 volume 設定保留自動快照（未設定時預設約 5 天，每月前 10GB 快照空間不另外收費）。手動備份：

```bash
fly volumes list
fly volumes snapshots create <volume-id>
fly volumes snapshots list <volume-id>
```

`<volume-id>` 是 `fly volumes list` 裡的 `vol_...`。還原時用 Fly 文件裡的 `fly volumes snapshots` 子命令，從快照開一顆新 volume，再把 `[mounts]` 掛上去。快照是這顆磁碟的備份，不是另一台資料庫。

## 費用

只有這一台機器加上一顆 1GB volume，沒有另外的 Postgres 或第二台 DB 機器。

以 Fly 定價頁（2026 年 10 月）的 **Ashburn（iad）** 為下限，東京 `nrt` 還要乘區域係數，實際金額以 [定價頁](https://fly.io/docs/about/pricing) 為準：

- `shared-cpu-1x`、256MB：機器**有在跑**時，iad 整月約 **2.19 美元**。這是最小的機器。better-sqlite3 在映像檔建置時就編譯好，bcryptjs 是純 JavaScript，執行時不需要為了編譯再開大。若啟動時被 OOM 殺掉，把 `fly.toml` 的 `memory` 改成 `"512mb"`（iad 整月約 3.69 美元）再 `fly deploy`。
- 機器停掉之後，CPU 與記憶體不再計費。停掉的機器仍按 rootfs 容量計費，約 **每 GB 每月 0.15 美元**。
- volume 按配置容量計費，1GB 約 **每月 0.15 美元**，機器停著也照算。
- 快照儲存約每 GB 每月 0.08 美元，每月前 10GB 免費。
- 共用 IPv4 與 IPv6 不另外收費。不要加專用 IPv4，否則約每月 2 美元。
- 從 `nrt` 出去的流量屬亞太，約 **每 GB 0.04 美元**。進來的流量不收費。

閒置時自動停機，所以平常大多只付 volume（以及停機 rootfs），有人連線才付機器的秒數。

## GitHub Actions

`.github/workflows/fly-deploy.yml` 在推上 `main` 時部署。它讀 repository secret `FLY_API_TOKEN`。沒有這個 secret 時，job 會略過，不會把檢查弄紅。

在本機建立 deploy token（不要把 token 貼進 repo）：

```bash
fly tokens create deploy
```

到 GitHub 這個 repo 的 Settings → Secrets and variables → Actions，新增 `FLY_API_TOKEN`。第一次自動部署之前，要先做完上面的 `fly launch`、`fly volumes create` 與 `fly secrets set`。

## 映像檔

`docker build` 是多階段的：建置階段用 corepack 安裝 pnpm 10.33.4，編譯畫面與原生模組；最後一個階段只有 Node 22 slim、正式依賴、`dist`、示範範本與伺服器原始碼。沒有 TypeScript、Vite、ESLint 或測試工具。伺服器行程在打開資料庫之前會把 `/data` 的擁有者改成 uid 1001（`app`），然後放棄 root。
