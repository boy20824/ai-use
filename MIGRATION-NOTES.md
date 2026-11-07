# 基本 SOP／情境模組：盤點與遷移設計

## 狀態與範圍

已依使用者決定實作。原 BLOCKER 已解除：採 option a，多樣態步驟以同一 step ID 各引用一次至每個對應模組；任一模組選取即顯示（OR／聯集），不複製實體。使用者接受排序改為「基本 SOP 優先，再依模組順序逐模組加入」，不再維持舊條件步驟的全域交錯順序。

以下盤點保留作遷移依據；原 AND 行為僅為歷史說明，現行顯示以明確引用聯集為準。

以下為目前程式與本地 SQLite 的盤點，並非正式環境資料認證。筆數屬執行期資訊，不應成為遷移常數或部署假設。

## 現有模型與排序

| 項目           | 現有儲存及行為                                                                                                                                                     | 映射注意事項                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 案件類別       | `categories`：`id`、`code`、`name`、`summary`、`updated_at`、`group_name`。名稱唯一；讀取列表依中文名稱排序。                                                      | 保留 ID、代碼、名稱及全部欄位。                                                                                                            |
| 大類 groups    | `categories.group_name` 為 `criminal`／`admin`／`internal`，UI 分別為刑案／一般行政／內部申請；沒有獨立 groups 表。                                                | 大類不是樣態或模組，不改成模組、不變更歸屬。                                                                                               |
| 樣態 variants  | `category_variants(id, category_id, name)`；名稱在同類別內唯一；現有讀取依 `rowid`，沒有 `sort_order` 欄位。                                                       | 可安全映射的樣態保留 ID 與同案類歸屬；必須捕捉原始 `rowid` 順序。                                                                          |
| 步驟實體       | `category_steps(id, category_id, sort_order, body, details)`；每個 ID 隸屬一案類。`details` JSON 存 `order`、`title`、`items`、`note`、`variantIds`。              | 不能只複製 body，也不能依同名合併。兩種排序來源與條件語意都須盤點。                                                                        |
| 步驟順序       | SQL 依 `sort_order, id` 讀取；hydrate 先給 `order` 預設讀取索引，再以 JSON 的 `order` 覆蓋、排序。工作台先共同步驟，再條件步驟，各依 `order`。                     | 新引用排序應保存有效的原 `details.order`；缺少時使用原 SQL 讀取序位。保留原 `sort_order` 及 JSON 供追溯；同值再依 step ID。                |
| 步驟與樣態     | `details.variantIds` 是 ID 陣列；空陣列代表共同步驟，非空代表陣列內樣態必須**全部**勾選。沒有獨立 step-variant 關聯表。                                            | 一個樣態可直接映射；多個不同樣態依使用者決定改為 OR／模組聯集，詳見已確認決策。                                                            |
| 範本           | `templates` 儲存 DOCX 資訊、placeholders 及 BLOB；既有檔案服務也支援 uploadDir 內文件。                                                                            | 保留實體 ID、內容、檔案及既有存取流程，不產生副本。                                                                                        |
| 範本多對多     | `step_templates(step_id, template_id, sort_order)`，複合主鍵；依 `sort_order, template_id` 讀取。同範本可供多步驟引用。                                            | 保留所有主鍵組合、排序及連結，不重建為一對一；共享 step ID 即共享範本設定。                                                                |
| 案件欄位定義   | `category_fields(id, category_id, name, key, type)`，同案類 key 唯一，依 `rowid` 讀取。                                                                            | 定義保留；案件輸入值不寫進此表或新表。                                                                                                     |
| 來源／目標樣態 | `CategoryFormView.vue` 的 `copySource`、`copyTarget` 是前端 ref；兩個 select 用於複製步驟。複製會建立新 step ID、保留範本 ID，將新步驟 `variantIds` 設成目標樣態。 | 本次查閱的 schema **沒有**來源／目標專屬 DB 欄位；不能把 UI 選項誤認為欄位並刪除既有樣態、步驟或連結。若其他部署含額外欄位，亦須原樣保留。 |

主要依據：`server/src/db.ts` 的建表、`migrate`、`hydrateCategory`、`writeSteps`、`writeDetails`，`server/src/app.ts` 的 Zod schemas、`extrasValid`、類別與子資源路由，`src/types/domain.ts`，`src/views/CategoryFormView.vue`，`src/views/CategoryView.vue`。

目前沒有獨立基本 SOP 引用、模組、模組步驟引用表。現有類別更新是 aggregate 更新：省略既有步驟會刪除實體及其範本連結；`writeDetails` 會重寫樣態與欄位。新引用功能不能直接把這條路徑當作「移除引用」。

## 執行期資料盤點

2026-11-07 對本地 `server/data/app.sqlite` 使用 SQLite `mode=ro`、`query_only` 及單一讀取交易檢查；未啟動伺服器或呼叫會執行遷移／seed 的初始化流程。只讀 schema 與統計，不記錄範本內容或案件值。

| 項目                                | 此次本地快照筆數 |
| ----------------------------------- | ---------------: |
| categories                          |                0 |
| category_variants                   |                0 |
| category_fields                     |                0 |
| category_steps                      |                0 |
| templates                           |                1 |
| step_templates                      |                0 |
| 無樣態／單樣態／多個不同樣態的步驟  |          0／0／0 |
| 無效 details／缺失或跨案類樣態引用  |             0／0 |
| JSON order 與 sort_order 不同的步驟 |                0 |
| foreign_key_check 違規              |                0 |

本地快照未含受影響實例；不能據此推定其他部署無資料，或忽略已有 UI、API 與測試保障的 AND 能力。未取得正式資料庫，未推算正式影響筆數。

## 映射設計（已實作）

1. 保留所有舊表、欄位、JSON、ID、範本連結及排序。新增模組與引用結構，不改寫舊 `variantIds`，不預塞任何真實或 Mock 流程。
2. 每個樣態映射為同案類模組，沿用 variant ID 作 module ID，保存來源 variant ID 與原始順序的追溯資訊。舊樣態沒有顯式排序，依該案類原 `rowid` 順序產生明確 module `sortOrder`，另留原 `rowid`。新讀取依 `sortOrder, id`。
3. 無樣態步驟以原 step ID 建立基本 SOP 引用；具有樣態 ID 的步驟，以原 step ID 在每個不同樣態對應模組建立一次引用。不複製步驟實體或範本。孤立、跨案類、損壞 JSON／排序先回報並回滾，不能靜默丟棄或攤平。
4. 基本與模組內引用使用有效的舊 JSON `order`；缺少時使用原 SQL 讀取序位，同值依 step ID。保留舊 JSON 與 SQL 排序值作追溯。同一模組內 `(moduleId, stepId)`、基本 SOP 內 `(categoryId, stepId)` 應唯一。
5. `step_templates` 完全沿用原 `(step_id, template_id, sort_order)`；不因新增引用刪除或重排文件。大類、欄位定義與額外舊欄位原樣保留。
6. 前端合成為基本引用順序，接著所選同案類模組的 `sortOrder, id`，再各自引用的 `sortOrder, stepId`；依 step ID 首次出現去重。同名不同 ID 保留。切換案類清除本次模組選取；沿用以 step ID 記錄完成 checkbox 的前端狀態與既有清除時機。案件值、模組選取不傳後端、不持久化、不新增產出稽核。

使用者已接受以下排序差異：舊工作台將所有符合條件的步驟依全域 `order` 排序；新規格依模組成批加入。若不同樣態的舊步驟原本交錯，單一模組排序可能無法維持所有組合的舊相對順序；新順序明確為基本 SOP、再模組批次；舊 SQL 排序與 JSON 全部保留可追溯，不能宣稱全域順序等價。

## 權限、寫入與回復設計（已實作）

- 現行 `requireCategoryManager` 允許 sysadmin 或 `canManageCategories`；後者是帳號級旗標，不是新增每案類 ACL 的授權。沿用現行登入、停用帳號、Session／CSRF 與維護權，逐次檢查資源案類歸屬，不擴權。
- 現有類別／範本 DELETE 已要求 sysadmin；variants／steps 子資源 DELETE 目前走維護權檢查，aggregate PATCH 也能間接刪實體。後續若實作，這些路徑都須處理，避免維護者繞過 admin-only 實體刪除。
- 「移除引用」必須使用明確關聯操作，僅刪該引用並記設定稽核。實體刪除須 admin-only，交易內重查影響；仍有引用的共用步驟拒絕刪除。不能沿用省略 step 即刪實體的 aggregate 語意。
- 所有管理寫入以 Zod 驗證 ID、名稱、排序、重複引用及案類歸屬，使用參數化 SQL；排序／引用／刪除及設定稽核應在同一交易。稽核記設定實體與關聯 ID、操作者及必要摘要，不記案件值或本次選取。
- 真正遷移前應以 SQLite 線上備份 API／一致性快照備份並試還原，不能只複製使用 WAL 中的主 DB 檔。保存文件儲存目錄的對應備份。另在備份副本做唯讀完整性與外鍵檢查。
- 新增式 schema、映射與校驗必須在單一交易，全部成功才寫入完成標記；再次執行需依完成標記跳過映射，不重新加入之後已移除的引用。失敗全部回滾，不用 IGNORE 吞掉不一致。完成前比對各舊表筆數、ID、排序、details、template links 與文件可用性。
- 現有 `migrate` 包含歷史 DROP／重建表與 `deleteSeededCategories` 清理，並非全程單一交易。不能直接宣稱既有入口符合「永不刪舊表／欄位／列」；解除阻擋後須限定安全入口或調整相關路徑，並在舊 schema 暫存 SQLite 連跑兩次、注入失敗驗證回滾與還原。此次沒有執行這些操作。

## 已確認決策：BLOCKER 已解除

2026-11-07 使用者明確選擇 option a：

- `variantIds = [v1, v2]` 的步驟 X，在 v1、v2 對應模組各有一個指向 X 的引用，仍只有一個共用步驟實體及原 `step_templates`。
- 無模組選取：不出現 X；只選 v1 或只選 v2：出現 X；兩者皆選：X 只出現一次，保留首次位置。
- 原 `details.variantIds` 完整保留，沒有刪除、改成單一 ID 或覆寫；只有新合成行為採 OR／聯集。
- 使用者接受基本 SOP 先加入，再依模組 `sortOrder,id`、引用 `sortOrder,stepId` 加入；反向點選不改變輸出。

## 實作與回復

- `server/src/modules.ts` 新增 `category_modules`（variant ID、category ID、name、sort_order、source_rowid）、`base_step_refs`、`module_step_refs` 與 `config_migrations`。複合主鍵避免重複引用，完成標記避免重跑時復活已移除引用／模組。遷移為單一 SQLite 交易，異常全部回滾，未寫任何 Mock／預設流程至應用程式資料庫。
- `migrate()` 全入口改成交易，不再清理固定 seeded IDs。禁止歷史 DROP／重建表、帳號角色重寫：非常舊的 audience／template owner／無 step ID／舊角色或 audit CHECK schema 會明確報錯、原樣回滾。這些 schema 需另做已審查的歷史升級；本功能不假稱可安全自動轉換。當前 variants/details/step_templates schema 可直接遷移，其他自訂欄位不受新增表影響。
- `DELETE /api/categories/:id/refs/:scope/:stepId` 只刪指定 ref、同交易寫 `category_update` 設定稽核，完全不經 aggregate update。`PUT` 同路徑新增／更新引用，拒絕跨案類。`module:<id>` scope 可區分 ID 恰為 `base` 的模組。
- `PUT /api/categories/:id/order/:scope` 一次驗證完整同處 ID 集合，再於單一交易重排，`modules` 為模組排序、`base` 為基本 SOP、`module:<id>` 為模組內引用。
- aggregate update 不再刪省略的步驟，即使步驟暫時沒有引用也不刪除。步驟實體刪除僅 admin 可執行，交易內重查引用，有引用回 409 並列基本 SOP／模組／文件影響；無引用仍需明確確認。模組刪除僅 admin、需確認，刪模組及其 refs、保留共用步驟／範本／舊 variants。維護者直接呼叫仍 403。
- 新 editor 分基本 SOP／情境模組，支援新增、同案類既有步驟引用、共用編輯及影響位置、文件多對多、上傳、模組及引用排序、明確移除引用／admin 實體刪除；移除來源／目標樣態 copy UI。
- 工作台與文件總覽均依前端合成結果，案件值／模組選取只在記憶體；切案類清空，完成 checkbox 仍按 step ID 運作；不新增生成 API／生成稽核／持久化案件值。

正式遷移前停止應用寫入，以 `better-sqlite3` 的 `await db.backup(backupPath)` 取得一致性快照（不可只複製 WAL 中的主檔），備份 uploadDir，於副本執行 `PRAGMA integrity_check`／`foreign_key_check`，試開副本比對資料後才啟動新版。若需回復，停止服務，將已驗證快照還原至獨立 DB 路徑並還原對應文件，切回舊版程式；舊 JSON 及 variants 原樣保存，可由舊版讀取。不要對仍開啟的 SQLite 檔案覆蓋或刪 WAL。此工作僅對臨時測試 DB 驗證，未啟動或遷移工作區既有 DB。

## 驗證

新增 Vitest 驗證 ABC+D+J／ABC+FG+J／空選取、step ID 去重（同名不同 ID 保留）、選取順序獨立、同值穩定排序及跨案類隔離。UI 測試更新為 OR／union，保留每步完成 checkbox、切換清空、DOCX／列印安全測試。

臨時檔案 SQLite 測試植入舊 variants／details／step_templates（含多樣態步驟、重複 variant ID、JSON order 與 SQL 序位 fallback、同排序值與固定 seeded ID），比對所有舊列、ID、JSON、rowid、範本 BLOB／引用不變，連跑兩次，再驗證移除引用後重跑不復活。另以線上 backup 還原副本後重跑驗證，錯誤 JSON／排序／缺失及跨案類樣態測試完整回滾。

API 測試包含一般使用者寫入 403、maintainer 實體刪除 403、admin 引用中刪除被擋及影響清單、移除引用不刪步驟與稽核、aggregate 省略不刪步驟、跨案類引用／模組與 Zod 無效欄位拒絕。舊測試曾要求刪表／欄位、刪固定內容及改寫角色，現更新為安全拒絕且逐表比對完全不變。

執行結果：相同原始碼於不含本地 `.env` 的臨時隔離目錄執行完整 Vitest：23 個檔案、112 個測試全部通過。原工作目錄完整執行為 110 通過、2 個既有部署設定測試失敗：本地 `.env` 重新注入 demo seed 設定，與測試期望無該設定衝突；未修改環境檔或部署程式。前後端 TypeScript、變更檔 ESLint／Prettier、`git diff --check` 及 Vite production build 通過。

未連線網路、未安裝、未開 PR／合併／部署。
