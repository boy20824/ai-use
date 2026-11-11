# 細項欄位放置與姓名回復（2026-11-11）

案件填寫頁上方顯示日期與 `category_fields.scope='base'` 的手動欄位。
日期預設為台北今天的民國日期；日期衍生標記沿用此值。範本標記依目前可見步驟分組，
在各步驟的「本步驟欄位」依首次出現順序去重顯示。主流程、可同步作業區、總覽、
本次暫加範本使用同一份以欄位名稱為鍵的 reactive 值；共用標示依目前流程序號計算。
未選模組不出現也不參與必填檢查，切換模組保留同名值，離開流程或登出仍清除記憶體內容。

照片表單放在使用照片範本的步驟欄位區內，總覽也依對應步驟分組。
照片草稿繼續依範本 ID 隔離，保留 PR #38 的排序、攝影資訊、單張覆寫、預覽頁數與 ZIP 行為。
照片只留在瀏覽器，不送往伺服器。

## 一次性資料調整

`server/src/builtinFields.ts` 的 `applyRemoveBaseName(db, actor)` 由 `migrate()` 呼叫，
預設執行者為 `system/migration`。調整 ID 是 `2026-11-11-remove-base-name`。

- 新增 `category_builtin_fields`，將所有既有案類內建「姓名」設為 `enabled=0`。
- 新增 `data_adjustments`，保存每個案類原設定（`null` 代表原本未設定、原本顯示）、執行者與時間。
- `audit_log` 使用既有 `category_update` 動作，detail 記錄調整 ID、apply/revert 與受影響案類數。
- 設定、調整紀錄與稽核在同一交易完成；重跑 migrate 或已回復後重啟都不重套。
- 案類 API 的 `builtinFields.姓名` 回傳實際顯示設定；新建案類明確設為 false，回復不影響之後新建的案類。
- 不修改或刪除既有 `category_fields`、步驟、範本、模組、連結與組合順序。
  若手動基本欄位 key 是「姓名」，仍保留在上方；若只有範本使用姓名，則在步驟內填寫。

欄位值原本就只存在瀏覽器記憶體，沒有伺服器案件草稿資料表。本次不新增持久化或寫入欄位值的 API。
設定重新載入、欄位移位及流程重排沿用同一份填寫值。

## 回復內建姓名

在完成此版遷移的資料庫執行；操作前依既有程序備份資料庫。以下以「孟翰」作為稽核執行者，
實際操作時請換成實際執行者名稱。

本機，在 repo 根目錄使用與伺服器相同的環境設定：

```sh
node --experimental-strip-types server/scripts/revert-remove-base-name.ts 孟翰
```

Fly（app 為 `ai-use`），建議先備份：

```sh
fly ssh console -a ai-use -C "runuser -u app -- cp /data/app.sqlite /data/app.sqlite.bak-before-revert"
```

WAL 模式下若需一致備份，可改用 `sqlite3 .backup`；若映像無 `sqlite3`，則在低流量時段執行。

再執行回復：

```sh
fly ssh console -a ai-use -C "runuser -u app -- node --experimental-strip-types /app/server/scripts/revert-remove-base-name.ts 孟翰"
```

`fly ssh console` 以 root 執行，直接跑 node 可能讓 `/data/app.sqlite` 的 `-wal`／`-shm` 檔變成 root 擁有，導致服務（uid 1001 的 app 使用者）之後無法寫入，因此透過 `runuser -u app` 執行。

Dockerfile 明確把此腳本放進 `/app/server/scripts/`，其依賴的程式與 production 套件位於 `/app/server/`。
腳本共用 `loadEnvFiles()` 與 `databasePathFromEnv()`：讀取 root `.env`、server `.env`（server 優先），
`DATABASE_PATH` 的相對路徑以 server 目錄為準，預設 `server/data/app.sqlite`；Fly 映像設定為 `/data/app.sqlite`。
腳本不讀取或印出 session secret，不需要完整 HTTP 服務啟動設定，資料庫不存在時會停止。
必須提供執行者參數，只輸出是否回復成功，不印出環境變數或資料庫內容。

`revertRemoveBaseName(db, actor)` 依 payload 精確還原未設定／啟用／停用三種原狀，
保留其他內建設定，跳過已刪除的案類，不復活已刪除資料。
回復後填入 `reverted_at` 並追加稽核；重複回復不再寫入。
重新載入案件頁即可看到回復結果；原本未設定或啟用姓名的既有案類會恢復上方姓名，
原本已停用的維持停用。之後 `migrate()` 不會再套用這次調整。

## 驗證

只使用 Mock 資料與程式產生的 Mock DOCX。
`src/workbench/stepFields.test.ts`、`src/views/StepPlacement.test.ts` 與照片驗收測試涵蓋規格第 5 節 1–9；
`server/src/builtinFields.test.ts` 逐表比對遷移前後所有其他表的資料列，測試 up/down、冪等與稽核交易；
`server/src/v13spec.test.ts` 測試 API、權限及手動新增姓名。

```sh
node_modules/.bin/vitest run
node_modules/.bin/vue-tsc --noEmit
node_modules/.bin/tsc --noEmit -p server/tsconfig.json
node_modules/.bin/eslint . --max-warnings 0
node_modules/.bin/prettier --check $(git ls-files '*.ts' '*.vue' '*.md' '*.json' '*.css')
```

新檔也須納入 Prettier 檢查；`evidence/` 不加入版本控制。
