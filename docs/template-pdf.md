# PDF 參考文件

範本 API 與範本庫回傳 `kind: "docx" | "pdf"`。既有 SQLite 資料以非破壞性加欄位方式預設為 `docx`；Word 仍使用原有 `${id}.docx` 路徑，PDF 使用 `${id}.pdf`。替換檔案必須維持相同類型，PDF bytes 也計入儲存配額。

PDF 上傳需同時符合 `.pdf` 副檔名、`application/pdf` MIME 與檔案最前面的 `%PDF-` 檔頭（不接受 BOM 或空白前綴）。上限為 20 MiB，可用 `MAX_PDF_UPLOAD_BYTES` 調整；Word 維持原本 `MAX_UPLOAD_BYTES` 上限，預設 8 MiB。PDF 的 `placeholders` 永遠是空陣列，不做 Word 正規化、ZIP 檢查、欄位解析或填寫，也不參與單檔產出與 ZIP。

PDF 可附加到步驟，顯示於「參考文件」。下載預設使用 `GET /api/templates/:id/file` 的 attachment 回應；預覽使用同一端點的 `?inline=1`（亦接受 `?disposition=inline`）。檔案回應保留正確 MIME、原檔名及 `X-Content-Type-Options: nosniff`。

預覽在點擊時先開新分頁，再從既有同源 API 帶登入憑證取得 bytes，以 `application/pdf` Blob URL 導向該分頁。Blob 僅存在記憶體，開啟 60 秒後撤銷 URL；預覽不寫入 localStorage 或 IndexedDB。頁面不使用 iframe、embed 或 object，CSP directives 完全不變。

系統管理員與具有 `canManageCategories` 的使用者可上傳、替換及附加；任何登入使用者可預覽及下載；只有系統管理員可刪除。上傳與刪除沿用稽核，刪除同時透過既有 ON DELETE CASCADE 解除步驟連結。未登入上傳、下載與預覽回 401；無維護權者上傳回 403，登入後的變更仍需 CSRF 驗證。

驗證僅使用測試 helper 動態產生的「作業規定（Mock）.pdf」，不加入實際文件。執行 `pnpm test`、`pnpm typecheck`；人工以維護者上傳 Mock PDF 並附加至步驟，再以一般登入使用者確認預覽／下載及 PDF-only 步驟不出現產檔操作。混合 Word／PDF 的單檔與 ZIP 產出應只包含 Word。
