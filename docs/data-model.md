# 資料模型與治理

這份文件給資料維護者、社群貢獻者與想了解專案邊界的人閱讀。它說明 SITCON Credits 記錄什麼、資料權威在哪裡，以及 profile 與歷史紀錄如何分工。

## 資料分層

SITCON Credits 刻意把「歷史貢獻紀錄」和「個人公開簡介」分成不同層次。

歷史貢獻紀錄記錄某個公開名稱在某場 SITCON 相關活動中擔任什麼角色，例如工作人員組別、講者身份、場次類型與來源 URL。這些紀錄來自歷屆活動官網等公開來源，經整理與審核後，以 canonical Google Sheet 作為主要發布資料源。

個人公開簡介是本人 opt-in 提供的 profile 資料，例如偏好的顯示名稱、簡介、頭像、公開 email 與公開連結。這些資料由 [`credits-profiles`](https://github.com/sitcon-tw/credits-profiles) 的 `profiles/` 維護，適合透過 GitHub Pull Request 讓本人或維護者更新。

活動網站來源 profile 是維護者從歷屆活動公開網站整理出的顯示用名稱與頭像。這些資料由 `credits-profiles` 的 `site-profiles/` 維護，只作為前端顯示 fallback，不是本人 opt-in，也不是身份合併。

## 收錄範圍

第一階段預設收錄 SITCON 相關活動中的：

- 工作人員
- 講者

活動範圍包含但不限於：

- SITCON 年會
- SITCON Camp
- Hour of Code
- Hackathon
- 其他由 SITCON 主辦、共同主辦、以 SITCON 品牌正式舉辦或長期維護的社群活動

協辦、合作或社群成員自行參與的活動不會自動納入。一般參與者、投稿未錄取者、贊助商窗口或其他非公開貢獻角色，也不是第一階段的預設收錄對象。若未來要擴充範圍，應先更新文件與資料政策。

## 資料來源與權威

歷屆活動官網是歷史貢獻紀錄的原始依據。每場活動都應盡可能保留對應來源 URL，讓後續維護者可以查核資料從哪裡來。

Google Sheets 是整理、審核與發布前的主要維護介面。若歷屆官網與 canonical Sheet 中的審核資料不同，公開輸出以維護者在 canonical Sheet 中確認後的資料為準。

`credits-profiles` 是 profile 顯示資料的來源，不是歷史紀錄或身份合併的權威。某個 GitHub username 有 profile 檔案，只代表該 username 有一份 opt-in profile；某筆歷史 appearance 是否連到該 username，仍以 canonical Sheet 中經維護者審核的 `github_username` 裸值為準。`site:<source_person_id>` 只代表同一活動網站來源中的顯示用 profile。

## Google Sheets

維護三張工作表：

- `appearances`：每列代表一個人在一場活動中的一筆公開貢獻紀錄。
- `events`：活動清單與活動層級來源 URL。
- `people`：由工具同步的 profile 參照清單，協助 Sheets 操作者選擇或檢查 GitHub username。

### appearances

`appearances` 的重點欄位：

- `event_id`：對應 `events.event_id`。
- `role_group_zh` / `role_group_en`：公開顯示的組別或場次類型。工作人員填組別，講者填演講或場次類型。
- `role_title_zh` / `role_title_en`：公開顯示的身份。工作人員填組長、組員等；講者填講者、主持人、與談人等。
- `display_name_at_event`：該活動當時公開顯示的名稱。
- `github_username`：profile reference。填裸 GitHub username 表示維護者已審核連到 contributor-owned profile；填 `site:<source_person_id>` 表示同一列 `event_id` 對應活動網站來源中的顯示用 profile。
- `source_url_override`：只有這筆紀錄的來源不同於活動層級來源時才填寫。
- `notes`：維護備註，不放私人聯絡資訊。

`role_group_zh` / `role_group_en` 是公開組別或場次類型，不是 staff/speaker 分類欄位。若未來需要新的分類欄位，應先更新資料政策與文件。

英文欄位可以留空。英文輸出應 fallback 到對應繁體中文欄位，不應自動翻譯，也不需要因英文欄位留空產生資料品質報告。

### events

`events` 的重點欄位：

- `event_id`：穩定、可讀的活動 ID，例如 `SITCON-2026` 或 `SITCON-Camp-2026`。
- `event_series`、`event_name_zh`、`event_name_en`、`event_year`：活動顯示與分類資訊。
- `official_site_url`、`staff_source_url`、`speaker_source_url`：活動與貢獻紀錄來源。
- `notes`：活動層級維護備註。

來源 URL 通常放在 `events`。工作人員來源使用 `staff_source_url`，講者來源使用 `speaker_source_url`；只有特定 appearance 的來源不同時才使用 `appearances.source_url_override`。

### people

`people` 只包含：

- `github_username`
- `display_name`

`people` 是選取提示與維護提醒，不是封閉允許清單。`appearances.github_username` 的裸 GitHub username 不在 `people` 中可能代表 profile template 尚未建立，或身份連結仍待維護者審查；這是維護提醒，不是自動錯誤。`site:` profile reference 不會出現在 `people`。

`people` 由 `credits-profiles/profiles/` 的 contributor-owned profile 檔案同步產生，也可以保留維護者在 Sheet 中先填入、但 profile 檔案尚未存在的待處理 username。這兩個方向都只是讓 helper sheet 與 profile repo 對齊，不會自動更改 `appearances.github_username` 或完成身份合併。

## 身份與 profile 原則

同一個人可能在不同年份或活動中使用不同名稱、暱稱、英文名或 GitHub 帳號。本專案採取 appearance-first model：先保留每筆公開活動出現紀錄，再由維護者審核是否連到某個 GitHub username profile。

請不要只因以下線索就自動合併身份：

- 顯示名稱相同或相似
- 暱稱相似
- romanization 相似
- GitHub 帳號名稱相似
- 本人或他人在未審核 PR 中的敘述
- LLM 推論或過往記憶

本人提出 profile PR，或透過 Pages 網頁標記哪些公開紀錄可能是在記錄自己，是建立關聯意願與審核線索，不是自動身份合併。若不確定是否為同一人，應先保持紀錄分開。

若某筆 appearance 使用 `site:<source_person_id>`，本人日後提出 `profiles/<github_username>.json` PR 時，維護者應人工確認後才把 Sheet 中的 profile reference 改成裸 GitHub username。不要把 `site:` reference 自動轉成 username。

### 索引頁的顯示分群

公開索引頁會把頭像畫成一片立體的徽章場，並在顯示層把兩種公開紀錄合併成同一顆徽章：`source_person_id` 相同的 site profile 紀錄，以及正規化後顯示名稱相同、活動年份相差不超過一年且不屬於同一場活動的 site profile 紀錄。

這個合併只存在於建置產物 `assets/index-data.json`：

- 不會寫回 Google Sheets，`appearances` 的每一列都保持原樣。
- 不會把公開紀錄連到 GitHub username，也不會把 site 紀錄併入 GitHub-linked profile。
- 不構成身份連結核可；維護者的人工審核流程完全不變。
- 頁面上必須明確說明這是顯示分群，讓讀者知道畫面上的一顆徽章不等於一個已確認的身份。

GitHub-linked 與未連結（`appearance`）紀錄一律各自成為單獨的徽章，不會被合併。

## 隱私與更正

本專案只公開完成貢獻紀錄索引所需的資料，例如活動名稱、年份、角色、當時公開顯示名稱、來源 URL 與 profile 連結狀態。

不應公開或提交：

- 私人 email、電話、地址或證件資料
- 內部工作文件中的聯絡資訊
- 未經本人同意公開的社群帳號
- 與公開貢獻紀錄無關的私人資訊

本人可以要求移除或修改 profile 層資料，例如簡介、頭像、連結與偏好顯示名稱。若本人不希望被集中呈現在個人頁中，維護者可以解除歷史 appearance 與 profile 的連結；但已在歷屆官網公開的歷史貢獻紀錄，預設仍保留在活動脈絡中。

若原始官網資料本身有誤，維護者可以在 canonical Sheet 中記錄審核後的修正資料，並保留可追溯的來源 URL。
