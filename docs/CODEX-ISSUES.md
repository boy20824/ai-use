# Grok issue → Codex 開發

這個工作流程在 GitHub Actions 啟動獨立的 Codex CLI 任務，使用 OpenAI API 計費，不會喚醒既有聊天，也不使用已發布的雲端環境快照。它會依 repository 的 pnpm 鎖檔重建開發環境。

## 啟用

1. 將 `.github/automation/` 與 `.github/workflows/codex-issue.yml` 的變更合併至 repository 的預設分支。issue 事件只使用預設分支上的 workflow。
2. 在 repository 的 **Settings → Secrets and variables → Actions → Secrets** 新增 `OPENAI_API_KEY`。填入有 Responses API 使用權限與額度的 API key；不要把 key 放入 issue、程式碼或聊天。
3. 觸發帳號預設為 `boy20824`，符合 Grok 使用你的帳號發布的方式，不必設定額外 Variable。若日後改用專用 bot，可在同一設定的 **Variables** 新增 `CODEX_TRIGGER_BOT` 覆寫成實際留言作者的完整 GitHub 登入名稱。
4. 在 **Settings → Actions → General → Workflow permissions** 開啟 **Allow GitHub Actions to create and approve pull requests**。工作流程會明確宣告所需權限；不會核准或合併 PR。
5. 確認組織允許使用 `openai/codex-action` 與此 workflow 引用的官方 actions。

## 使用

讓 Grok 使用你的 `boy20824` 帳號在開啟中的 issue 新增留言：

```text
@codex 請依這個 issue 的需求開發，完成後建立 PR。
```

也可以由 Grok 使用同一帳號開立 body 包含 `@codex` 的新 issue。GitHub 無法區分你本人與 Grok 使用同一帳號發布的留言，因此你本人的 `@codex` 留言也會觸發。不處理編輯事件、PR 留言、關閉的 issue 或其他帳號；使用者名稱必須完全相符。單純指派 assignee 或 GitHub 通知設定不會觸發。

**如果 Grok 是由另一個 GitHub Actions workflow 執行**，請以專用 GitHub App installation token 或具 issue 寫入權限的 PAT 建立 issue／留言。GitHub 的內建 `GITHUB_TOKEN` 所產生的事件不會啟動另一個 workflow；在此 workflow 開啟 bot 選項無法解除這個限制。`CODEX_TRIGGER_BOT` 應填入該 token 實際產生的留言作者。

接受請求後，workflow 會回覆進度連結，安裝依賴、執行 Codex、強制執行 `pnpm test`、`pnpm build`、`pnpm check:sample`、`pnpm lint`，並把變更建立為 draft PR。失敗時回覆 Actions 紀錄連結；沒有變更時回覆說明。不同 issue 可以並行，同一 issue 依序執行。每則有效留言是獨立任務，不會自動更新先前 PR，也不會讀取整串討論；請將完整需求放入 issue 本文與觸發留言。

Codex 執行階段沒有 repository 寫入 token；建立 PR 的步驟在另一個 runner 執行，不執行生成的程式碼。workflow 不接受對 `.github` 的修改；自動化調整應另開人工開發任務。程式產生的檢查報告仍需由 reviewer 檢閱。以 `GITHUB_TOKEN` 建立的 PR／push 不保證觸發其他 CI，這個流程已在建立 PR 前執行專案檢查。PR 不會自動合併、部署或發布環境。

## 驗證

本機可執行：

```sh
node .github/automation/codex-trigger.test.mjs
pnpm lint
```

設定 Secret 並合併後，讓 Grok 在測試 issue 留言，確認：

- issue 出現接單回覆與 Actions run 連結。
- Actions 中開發及檢查成功。
- issue 出現 draft PR 連結，PR 有實際變更與驗證結果。
- 其他帳號留言不會啟動 `develop` job。

在遠端實測完成前，不能視為串接已啟用。環境發布本身不會啟用 GitHub Actions。
