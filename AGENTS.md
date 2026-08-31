# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v54.0.0/ before writing any code.

## 財產資料約定

- 財產清單存於 AsyncStorage key `@ncu-property-checking/property-items:v1`，值為 JSON object。
- object key 使用可直接比對掃描結果的條碼格式，例如 `3140101-03-40745`；每個 key 對應 `PropertyItem[]`，用來保留同一條碼下的多個實體；項目內不重複保留來源財產編號。
- 匯入支援財產系統 HTML 與通用 spreadsheet；HTML 匯入只更新項次、條碼、財產名稱與保管人，並保留既有的 `location`、`note` 等現場清點資料；`sourceYears` 優先記錄 HTML 標題中辨識出的民國年度，檔名年度只作為 fallback。
- Spreadsheet 匯入必要欄位是 `財產編號`、`名稱`、`保管人`；`項次` 選填，缺少時依該年度分頁資料順序自動產生。`.xlsx` 支援一般 ZIP/OpenXML（含 deflate 與 shared strings）；`.xls` 僅支援文字型 HTML/SpreadsheetML，舊式 binary `.xls` 需另存為 `.xlsx`。
- 年度清點狀態應維持在獨立的 AsyncStorage key（例如 `115_unknown`、`115_checked`、`115_pending`），值為字串陣列；不要寫回財產基本資料。新資料使用 entity key 格式 `條碼::entity:<index>`，例如 `3140101-03-40745::entity:0`，以便同一條碼下多個實體可分開盤點；舊版純條碼 entry 讀取時需相容並展開成該條碼下所有實體。
- 匯入某年度資料後，先預設建立該年度三個狀態 key，所有財產 entity key 先放在 `<year>_unknown`，`checked` 與 `pending` 為空陣列。
- 空間配置圖存於 AsyncStorage key `@ncu-property-checking/area-layout:v1`，值為 normalized JSON：page size + areas array；drawio 原始 XML 不直接當 App 顯示資料。
- 待製作財產標籤清單存於 AsyncStorage key `@ncu-property-checking/property-label-queue:v1`，值為條碼字串 array，使用者可從詳情頁加入或長按移除。
- 財產照片 metadata 存在對應 `PropertyItem.photos` 陣列中；照片檔案本體存於 app document 目錄 `property-photos/`，導入後應壓縮成 JPG，避免直接把原圖或 base64 放進 AsyncStorage。
