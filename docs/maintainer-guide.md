# 維護者指南

這份文件給需要操作 Google Sheets、GitHub Actions 或本地工具的維護者閱讀。一般社群貢獻者若只想新增或更新自己的 profile，請到 [`credits-profiles`](https://github.com/sitcon-tw/credits-profiles)。

## 本地工具

本 repo 的 Node.js 工具統一使用 pnpm。請不要使用 npm、yarn 或 bun 執行安裝或產生 lockfile。

不讀取憑證、不連線 Google Sheets 的檢查：

```bash
pnpm test
pnpm sheets:init:dry-run
pnpm sheets:export:dry-run
pnpm sheets:sync-people:dry-run
pnpm profiles:create-missing
```

匯出後可驗證本機資料：

```bash
pnpm data:validate
```

`data:validate` 只讀取本機 `tmp/sheets-export/export.json` 與 `config/sheets.json`，不會連線 Google Sheets，也不會讀取 service account credentials。

若本機有 sibling checkout `../credits-profiles/site-profiles/`，`data:validate` 也會檢查 `site:<source_person_id>` 是否能對應到 `site-profiles/<event_id>/<source_person_id>.json`，並檢查 site profile 只含 `display_name` 與 `avatar_url`。若 checkout 不存在，本機驗證只做 `site:` 語法檢查。需要指定路徑時可使用：

```bash
pnpm data:validate --site-profiles-dir=tmp/credits-profiles/site-profiles
```

`sheets:sync-people:dry-run` 會從本機 `tmp/credits-profiles/profiles/` 讀取 profile 檔案並列出將同步到 `people` 的 rows，不會連線 Google Sheets。`profiles:create-missing` 會讀取本機 `tmp/sheets-export/export.json` 中的 `people` rows，並在本機 `tmp/credits-profiles/profiles/` 補上缺少的空白 profile template。這兩個工具都不處理 `site-profiles/`。

Profile 檔案格式、site profile 檔案格式、`pnpm profiles:validate` 與 `pnpm site-profiles:validate` 由 `credits-profiles` 維護。

## 需要憑證的 Google Sheets 操作

需要操作 Google Sheets 時，維護者需先將 service account JSON 放在不會被 commit 的本機路徑，並設定：

```bash
export GOOGLE_APPLICATION_CREDENTIALS="$PWD/credentials.json"
pnpm sheets:init
pnpm sheets:export
```

`sheets:init` 會建立或更新工作表結構、欄位 note、基本資料驗證與條件格式，不會清空既有資料列。`sheets:export` 會讀取 canonical Google Sheet 並輸出到 `tmp/sheets-export/`；`tmp/` 是本機產物，不應提交。

LLM agents 不應讀取 service account credentials，也不應在沒有明確要求時執行會讀取 `GOOGLE_APPLICATION_CREDENTIALS` 或接觸 Google APIs 的命令。

## GitHub Actions

已定義的 workflow：

| Workflow | 觸發方式 | 職責 |
| --- | --- | --- |
| `CI` | pull request、`master` push、手動觸發 | 執行 `pnpm test`、`pnpm sheets:init:dry-run`、`pnpm sheets:export:dry-run`。 |
| `Export Sheets data` | 手動觸發 | 匯出 canonical Google Sheet、checkout `credits-profiles`、執行含 site profile 檢查的 `pnpm data:validate`、上傳 artifact，並直接 commit 缺少的空白 profile template 到 `credits-profiles`。 |
| `Sync people helper` | `credits-profiles` repository dispatch、手動觸發 | 將 `credits-profiles` 的 profile username 與 display name 同步到 Google Sheets 的 `people` helper sheet。 |
| `Review profile PR` | `credits-profiles` repository dispatch | 匯出 canonical Google Sheet，確認 profile PR 的 username 是否已出現在 `appearances.github_username`，符合條件時核准並 squash merge，不符合時留言提醒維護者。 |
| `Review profile claim issue` | `credits-profiles` claim-only issue dispatch | 當 profile issue 產出的 JSON 沒有變更但含 `site:` 標記網址時，匯出 canonical Google Sheet，在原 issue 建立或更新維護者確認 comment。 |
| `Apply profile claims` | `credits-profiles` PR 或 issue comment checkbox dispatch、手動觸發 | 維護者確認標記網址後，重新驗證 confirmation comment 與 canonical Sheet，將仍符合的 `site:` appearances 改成該 GitHub username；PR mode 會重跑 profile PR review，issue mode 會觸發 Pages rebuild。 |
| `Deploy GitHub Pages` | `master` push、profile rebuild dispatch、手動觸發 | 匯出 canonical Google Sheet、checkout `credits-profiles`、驗證資料與 site profile references、建立 `dist/`，部署到 GitHub Pages；profile PR 或 claim-only issue 觸發的部署成功後，回到對應 PR 或 issue 留言告知公開頁面連結，並關閉 linked issue 或原 issue。 |

profile issue form 產生的 PR 會用 `Refs #...` 連回原 issue，而不是使用 GitHub 會在 PR merge 時自動關 issue 的 close keyword。profile PR merge 只是 `credits-profiles` 的 profile JSON 已合併，還要等 `credits` 重新匯出 canonical Sheet、重建並部署 Pages 後，公開頁面才可確認。issue 的完成狀態因此由 `Deploy GitHub Pages` 的部署後 comment/close 控制；若連續 profile merge 讓較早的 Pages run 被 concurrency 取消，後續成功部署會掃描近期已 merge 的 profile PR，補齊被取消 run 遺失的 issue 收尾。

`CI` 不讀取 service account credentials、不連線 Google APIs，也不匯出 canonical Sheet。`Export Sheets data`、`Sync people helper`、`Review profile PR` 和 `Deploy GitHub Pages` 需要維護者先在 GitHub repository secrets 設定 `GOOGLE_SERVICE_ACCOUNT_JSON`。

跨 repo 寫入、留言、核准或合併 `credits-profiles` 另需安裝 `SITCON Credits Assistant` GitHub App，並設定：

- repository variable：`SITCON_CREDITS_ASSISTANT_APP_CLIENT_ID`
- repository secret：`SITCON_CREDITS_ASSISTANT_APP_PRIVATE_KEY`

這個 GitHub App 應安裝在 `sitcon-tw/credits` 與 `sitcon-tw/credits-profiles`，不應使用維護者個人 token。workflow 產生的 commit author 會固定為 `SITCON Credits Assistant`，committer 會使用 `sitcon-credits[bot]` 的 noreply email。

`Review profile PR` 若看到 PR 內有 `?claim=1&claims=...` 標記網址，且標記可精準對到 canonical Sheet 中仍存在的 `site:` references，會建立維護者確認 comment。維護者勾選 comment 內的確認 checkbox，代表確認這些歷史 appearances 可連到該 PR 的 GitHub username；系統會重新匯出 Sheet、確認值仍完全符合、才寫回 `appearances.github_username`。

若 profile request issue 產出的 profile JSON 已和現有 profile 檔案相同、branch 也沒有可開 PR 的差異，但 issue 內仍有 `site:` 標記網址，`credits-profiles` 會改 dispatch `Review profile claim issue`。這條 issue-only 流程不建立空 commit 或空 PR；`credits` 只會在有待確認 rows 時維護一則固定 marker comment，內容未變時不更新，避免對 issue 建立者產生多餘通知。維護者勾選後，`Apply profile claims` 會用 confirmation comment id 重新驗證 metadata、checkbox 與 plan hash。若 GitHub 沒有觸發 comment event，可手動執行 `Apply profile claims` workflow；PR mode 需輸入 PR number、head SHA 與 confirmation comment id。

## profile template 與 people helper

`Export Sheets data` 會讀取 `people.github_username`，為 `credits-profiles` 尚不存在的 username 建立空白 profile template。這是讓 contributor 後續可以自助補資料的佔位範本，不代表身份連結已審核，也不會填入 profile 細節。

`Sync people helper` 會讀取 `credits-profiles/profiles/*.json`，同步 `github_username` 與 `display_name` 到 Google Sheets 的 `people` helper sheet。同步時會保留 Sheet 中已存在但 profile repo 尚未有檔案的待處理 username，方便維護者先在 `appearances.github_username` 或 `people` 中留下後續 template 建立線索。

`appearances.github_username` 也可以填 `site:<source_person_id>`，連到同一列 `event_id` 對應的 `credits-profiles/site-profiles/<event_id>/<source_person_id>.json`。site profile 只作為活動網站來源顯示資料，不進 `people` helper、不產生空白 profile template，也不讓自助 profile PR 自動通過。本人日後送出 profile PR 時，維護者人工確認後才把 `site:` 改成裸 GitHub username。

`Export Sheets data` workflow 會先 checkout `credits-profiles`，再以 `tmp/credits-profiles/site-profiles` 驗證 canonical Sheet 中的 `site:` references。這是 credentialed export path 的強制檢查；如果 Sheet 填了不存在或格式錯誤的 site profile reference，workflow 會在建立 profile template 前失敗。

## 部署與外部設定

GitHub Pages 使用 GitHub Actions 作為部署來源；`Deploy GitHub Pages` workflow 會負責匯出 canonical Sheet、驗證資料、建立靜態網站並部署。若 Pages 設定、domain、repository secret 或 Google Workspace 權限異動，請同時檢查 `.github/workflows/pages.yml` 與 [自動化流程](workflows.md) 的描述。

Pages 前端是公開索引與標記流程的原型凍結版。維護者仍應處理部署失敗、資料安全或隱私風險、公開資料明顯錯誤、既有必要流程無法使用等例外；一般前端功能、介面微調、體驗修補或重新設計期待，請導向 [Pages 前端重新設計需求盤點](https://github.com/sitcon-tw/credits/issues/2)，不要直接在原型上收斂零散 PR。

workflow 檔案存在不等於外部設定都已生效。文件若提到跨 repo commit、profile PR 自動審查、Google Sheets 寫入、branch ruleset 或 GitHub App 權限，應明確區分「repo 內已有 workflow」與「GitHub / Google Workspace 設定已確認」。若未來新增 Forms、public search index、資料 schema 或新的跨 repo 自動化，請先更新 [資料模型與治理](data-model.md) 和 [自動化流程](workflows.md)。
