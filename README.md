# SITCON Credits

SITCON Credits（SITCON 貢獻紀錄）整理 SITCON 歷年公開的工作人員與講者貢獻紀錄，讓社群可以更容易回顧某場活動、某個角色或某位夥伴曾經參與的公開紀錄。

多年來，SITCON 相關活動的工作人員與講者資訊分散在歷屆官網、活動頁、議程頁與其他公開頁面。這個專案把那些公開紀錄整理成可長期維護、可追溯來源、可由 GitHub Pages 呈現的索引，同時讓曾經參與的夥伴可以 opt-in 補充自己的公開簡介、頭像與連結。

這裡記錄的是公開活動脈絡中的貢獻，而不是排行榜、會員名冊或身份資料庫。若某筆歷史紀錄要連到某個 GitHub profile，仍需要維護者根據 canonical Google Sheet 審核；個人 profile PR、標記網址或相似名稱都只是審核線索。

## 快速入口

| 你想做什麼 | 請看 |
| --- | --- |
| 了解這個專案記錄什麼、資料怎麼分層 | [資料模型與治理](docs/data-model.md) |
| 了解兩個 repo 的 GitHub Actions 如何互相觸發 | [自動化流程](docs/workflows.md) |
| 維護 Google Sheets、匯出資料或設定 GitHub App | [維護者指南](docs/maintainer-guide.md) |
| 新增或更新自己的公開 profile | [credits-profiles](https://github.com/sitcon-tw/credits-profiles) |
| 標記可能是自己的歷史貢獻紀錄 | [標記我的貢獻紀錄](https://sitcon.org/credits/?claim=1) |
| 提供 Pages 前端期待、想像或使用情境 | [Pages 前端重新設計需求盤點](https://github.com/sitcon-tw/credits/issues/2) |
| 查看 canonical Google Sheet | [SITCON Credits Google Sheet](https://docs.google.com/spreadsheets/d/1L2drpIE2ocZF3Stba9X0DnLGmYi_igeGWUhaQB_evsQ/edit?gid=0#gid=0) |

GitHub Pages：https://sitcon.org/credits/

本地預覽可先用已匯出的 Sheets JSON 與 sibling `credits-profiles` checkout 產生：

```bash
pnpm site:build -- --export tmp/sheets-export/export.json
```

這只會建立本機靜態 `dist/` 產物，不會讀取 Google credentials，也不會部署 GitHub Pages。

Pages 網頁預設是公開貢獻紀錄查詢介面，不顯示標記工具。過去參與 SITCON 相關活動的夥伴若要請維護者確認哪些項目可能是在記錄自己，可以打開 [標記我的貢獻紀錄](https://sitcon.org/credits/?claim=1)，選取項目後分享該頁網址。這個流程只收集本人意願與審核線索，不會自動修改 canonical Sheet，也不會自動完成身份連結。

Pages 前端是公開索引與標記流程的原型凍結版，會繼續作為公開輸出使用，但不再接受零散功能開發、介面微調或體驗修補 PR。若想提供前端期待、想像、問題或使用情境，請集中留言到 [Pages 前端重新設計需求盤點](https://github.com/sitcon-tw/credits/issues/2)，作為後續訪談、設計討論與規劃輸入。

## 這個 repo 負責什麼

本 repo 維護 SITCON Credits 的核心資料模型、Google Sheets 工具、資料驗證、匯出流程，以及 GitHub Pages 靜態網站建置。它負責的是「歷史貢獻紀錄」：某個公開名稱在某場 SITCON 相關活動中擔任什麼角色，以及這筆資料的來源。

個人公開簡介放在獨立的 [`sitcon-tw/credits-profiles`](https://github.com/sitcon-tw/credits-profiles) repo。那裡的 `profiles/` 存放本人 opt-in 提供的 profile 資料，例如偏好的顯示名稱、簡介、頭像、公開 email 與公開連結；`site-profiles/` 存放維護者從歷屆活動公開網站整理出的顯示用名稱與頭像。

這個分工很重要：

- 歷史貢獻紀錄由維護者在 canonical Google Sheet 中整理與審核。
- 個人 profile 由 contributor 透過 GitHub Pull Request 自助新增或更新。
- `appearances.github_username` 可以填裸 GitHub username 連到已審核 profile，也可以填 `site:<source_person_id>` 連到同一活動網站來源中的顯示用 profile；裸 username 連結仍是維護者審核後的資料判斷，不是 profile PR 自動完成的身份合併。

## 專案狀態

本 repo 已有：

- 不讀取 credentials 的 `CI` workflow，用來執行測試與 Google Sheets dry-run 檢查。
- 手動觸發的 `Export Sheets data` workflow，用 repository secret 匯出 canonical Google Sheet、驗證資料，並用 `SITCON Credits Assistant` GitHub App 直接 commit 缺少的空白 profile template 到 `credits-profiles`。
- `Sync people helper` workflow，可由 `credits-profiles` dispatch，將 profile repo 中的 username 與 display name 同步到 Google Sheets 的 `people` helper sheet。
- `Review profile PR` workflow，可由 `credits-profiles` dispatch，根據 canonical `appearances.github_username` 核准、合併或留言處理符合條件的自助 profile PR。
- `Deploy GitHub Pages` workflow，從 canonical Sheet 與 `credits-profiles` 建置並部署公開索引頁；`credits-profiles` 有新的 profile merge 時也會 dispatch 重新建置。

GitHub Pages 使用 GitHub Actions workflow 部署。其他需要跨 repo 寫入、留言、審查或合併的 automation，仍取決於 repository secrets、variables、Google Workspace 權限、`SITCON Credits Assistant` GitHub App 安裝與 branch ruleset。不要只因 workflow 檔案存在，就推定所有外部設定已完成。

## 如何參與

可以協助的方向包含：

- 補上歷屆活動官網中的工作人員與講者資料來源。
- 回報錯字、來源 URL 錯誤、角色資料錯誤或疑似錯誤合併。
- 在 `credits-profiles` 提出自己的個人簡介、公開連結或顯示名稱更新。
- 到 Pages 網頁標記可能是自己的貢獻紀錄，並把分享網址交給維護者確認。
- 協助整理 Google Sheets 欄位與維護流程。
- 到 [Pages 前端重新設計需求盤點](https://github.com/sitcon-tw/credits/issues/2) 留下對 GitHub Pages 前端的期待、想像、問題或使用情境。

請避免大量自動匯入或自動合併身份。這個專案的長期價值來自可信任、可維護、可追溯的紀錄，而不是一次性塞滿資料。

## 本地快速檢查

本 repo 的 Node.js 工具統一使用 pnpm。請不要使用 npm、yarn 或 bun 執行安裝或產生 lockfile。

不讀取憑證、不連線 Google Sheets 的檢查：

```bash
pnpm test
pnpm sheets:init:dry-run
pnpm sheets:export:dry-run
pnpm sheets:sync-people:dry-run
pnpm profiles:create-missing
pnpm site:build -- --export tmp/sheets-export/export.json
```

更多本地工具、需要憑證的 Google Sheets 操作與 GitHub Actions 設定請看 [維護者指南](docs/maintainer-guide.md)。

## 授權與資料使用

本 repo 的程式、設定與文件以 [MIT License](LICENSE) 授權。

歷史貢獻紀錄資料的使用脈絡、來源邊界與 profile 資料關係請看 [資料使用聲明](DATA_USAGE.md)。MIT License 不代表可以脫離 SITCON Credits 的社群感謝與可追溯來源脈絡，任意改寫、合併或再發布個人相關資料。
