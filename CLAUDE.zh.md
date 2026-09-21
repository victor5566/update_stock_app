# CLAUDE.zh.md

這份文件提供 Claude Code（claude.ai/code）在此專案中工作時所需的背景說明。為 [CLAUDE.md](CLAUDE.md) 的中文版，內容以英文版為準；若兩者不一致，請以 CLAUDE.md 為準。

## 專案簡介

一個管理美股（NASDAQ/NYSE/AMEX/OTC）股票代碼的維護系統：後端是純 Node.js/Express，前端是不需建置流程的原生 HTML/CSS/JS，資料儲存在 PostgreSQL。用途是維護股票代碼／公司名稱／交易市場清單——手動增刪改、批次匯入、以及自動比對 Yahoo Finance 抓出資料異常——不是交易或股價系統。

## 常用指令

```bash
npm install
npm start          # node server.js
npm run dev         # node --watch server.js
```

目前沒有設定測試或 lint 指令。

整個專案是在 WSL（Linux）中開發與執行，雖然專案資料夾實際放在 Windows 檔案系統（從 WSL 看是 `/mnt/c/Users/...`）。所有 `node`／`npm`／`psql` 指令都要在 WSL shell 裡執行，不要用 PowerShell。

### 資料庫

`sql/schema.sql` 是資料庫結構的唯一依據，寫法上刻意讓它可以重複執行而不出錯（`CREATE TABLE IF NOT EXISTS`、`ADD COLUMN IF NOT EXISTS`、`DROP CONSTRAINT IF EXISTS` 後再重建）——沒有用遷移（migration）框架，異動 schema 就是直接重跑這個檔案：

```bash
psql -h localhost -U <role> -d <db> -f sql/schema.sql
```

PostgreSQL 是在 WSL 本機執行。App 是透過 TCP（`localhost:5432`）用密碼驗證的專用帳號連線，不是用 `postgres` 超級使用者，也不是 peer 驗證——連線設定來自 `.env`（可參考 `.env.example`），由 `db.js` 讀取。

## 架構重點

**`stocks`** 是核心資料表（`stock_symbol` 唯一、`company_name`、`trading_market` 限制在四種市場、`source` 限制在 `manual | yahoo | excel_import | nasdaq_trader`）。有五張輔助表：
- `company_name_history` / `stock_symbol_history` ——異動歷史的 append-only 記錄，寫入時包在交易（transaction）裡，`stock_id` 設定 `ON DELETE CASCADE`（股票被刪除後，歷史也會跟著消失）。
- `stock_update_candidates` / `stock_removal_candidates` ——這是「快照」不是「日誌」：`scripts/check-stock-status.js` 每次執行都會先 `TRUNCATE` 再整批重新寫入這兩張表。也是 `ON DELETE CASCADE`，所以如果刪除一支剛好在「移除候選清單」裡的股票，它會自動從清單消失。
- `stock_deletion_log` ——唯一的例外：**刻意不設外鍵**，因為這張表的資料本來就是要在股票本身被刪除之後還留著。

**兩個「比對並記錄」的交易邏輯是最重要、最不直覺的機制**，都在 `routes/stocks.js`：
- `PUT /api/stocks/:id` ——先 `SELECT ... FOR UPDATE` 鎖定目前的資料列，執行更新，再比對更新前後的 `company_name`／`stock_symbol` 差異，視情況寫入前述兩張歷史表。
- `DELETE /api/stocks/:id` ——刪除該筆資料（用 `RETURNING` 取回內容），並在同一個交易裡把內容寫進 `stock_deletion_log`。

之後如果要修改股票更新或刪除的邏輯，一定要保留這些步驟，因為歷史表／紀錄表的資料完全靠它們產生。

**`source` 欄位是用來追蹤資料來源**，不只是留紀錄用：網頁上的「新增紀錄（手動輸入）」區塊，其實就是呼叫 `GET /api/stocks?source=manual`。只有 `POST /api/stocks`（網頁的新增表單）會把 `source` 設成 `'manual'`；各支匯入腳本各自會標記自己的來源值。之後如果新增其他寫入股票資料的方式，務必正確設定 `source`，否則會悄悄污染「手動新增紀錄」清單。

**路由**（`routes/*.js`）各自掛載在 `server.js` 裡不同的路徑前綴下（`/api/stocks`、`/api/company-name-history`、`/api/stock-symbol-history`、`/api/removal-candidates`、`/api/stock-deletion-log`）。`routes/stocks.js` 也提供 `GET /api/stocks/by-symbol/:symbol`，前端每個「先查詢再操作」的流程都靠這支 API（修改公司名稱／修改股票代碼／依代碼刪除，三個表單都是）——這些表單刻意使用文字輸入框＋共用的 `#stock-datalist` 自動完成，而不是 `<select>` 下拉選單（這是先前在這個專案裡依照回饋改回來的設計）。

**`lib/yahoo.js`** 集中管理 `yahoo-finance2` 的 client 以及 `EXCHANGE_TO_MARKET`（把 Yahoo 的交易所代碼，如 `NMS`／`NYQ`／`ASE`／`PNK`，對應到我們自己的四種市場分類）。`scripts/add-from-yahoo.js`（單一代碼查詢）跟 `scripts/check-stock-status.js`（批次檢查）都是從這裡引用，避免各自重複維護一份對應表。

**`lib/normalizeCompanyName.js`** 跟 **`lib/cleanSecurityName.js`** 是解決兩個不同問題的工具，不能互換：
- `normalizeCompanyName` 把名稱壓縮成一個「用來比較」的模糊指紋（先去除常見的公司後綴雜訊字，再去除所有空白）——只有狀態檢查腳本會用到，用來判斷兩個名稱是不是「其實是同一個」（例如 NASDAQ Trader 的 "JP Morgan Chase & Co. Common Stock" 要能跟 Yahoo 的 "JPMorgan Chase & Co." 比對相同）。
- `cleanSecurityName` 是拿來產生「真的要顯示／寫入資料庫」的乾淨名稱，做法是去掉結尾的證券類型敘述（像是「 Common Stock」、「 - Class A Ordinary Shares」、「 Depositary Shares, each representing...」），但保留正常的空格排版——用在真正「寫入」`company_name` 的地方（`scripts/import-nasdaq-trader.js` 跟一次性腳本 `scripts/clean-company-names.js`），不是拿來比對用的。

**`scripts/`** 底下是幾支獨立的維護工具，直接連資料庫（各自都有自己的 `require('../db')` 跟 `dotenv.config()`），設計上就是要從命令列執行、跟正在跑的網頁伺服器無關——刻意不透過網頁介面或 API 對外提供：
- `add-from-yahoo.js SYMBOL...` ——查詢並新增指定的股票代碼。
- `import-from-excel.js <path.xlsx>` ——從 Excel 檔批次匯入（欄位標題用模糊比對辨識；同一代碼若出現多次，以較後面那筆為準）。
- `import-nasdaq-trader.js` ——下載 NASDAQ Trader 官方上市清單，批次匯入所有 NASDAQ/NYSE/AMEX 股票，匯入時會先用 `cleanSecurityName` 把名稱清乾淨。**不含 OTC**（官方上市清單本來就不包含 OTC 資料）；目前 OTC 的資料只來自 Excel 匯入。
- `clean-company-names.js` ——一次性的回填腳本，對資料庫裡每一筆現有資料重新跑一次 `cleanSecurityName`，名稱有變的就更新。**不會**寫入 `company_name_history`——這是資料品質修正，不是真正的改名，不應該被當成一次異動記錄下來。
- `check-stock-status.js` ——把資料庫裡所有代碼分批（每批 200 筆）丟給 `yf.quote()` 查詢，並重建前述兩張候選清單表。之後如果要改這支腳本，注意兩個坑：呼叫 `yf.quote()` 時第三個參數要帶 `{}, { validateResult: false }`，否則一批 200 筆裡只要有一檔格式不符，整批都會被默默丟棄；另外，寫入資料庫前要把 Yahoo 回傳的文字用 `Buffer.from(str,'utf8').toString('utf8')` 處理過一輪，因為 Yahoo 偶爾會回傳不成對的 UTF-16 surrogate 字元，直接寫入會讓 Postgres 丟出無效編碼的錯誤。每次大規模清理公司名稱之後，建議重跑這支腳本——名稱髒亂會讓 `company_name_mismatch` 候選清單出現大量誤判。

**前端**（`public/`）就是一個 `index.html` 加 `app.js`，沒有用 bundler 或框架。之後要擴充時，請遵循已經在用的幾個模式：
- 多語系是用一個 `TRANSLATIONS` 物件（zh/en），透過 `data-i18n`／`data-i18n-placeholder` 屬性配合 `t()` 函式套用文字——不是用套件。
- 每個列表區塊（股票列表、移除候選清單、刪除紀錄）都是各自獨立做前端分頁，各自維護自己的 `PAGE_SIZE = 15` 狀態跟渲染函式，沒有抽成共用的元件。
- 「先查詢再操作」的三個表單（改名、改代碼、刪除）都遵循同一套結構：代碼輸入框配 datalist 自動完成、一個「查詢」按鈕會呼叫 `by-symbol` 並解鎖／鎖住表單其餘欄位、一個「清空」按鈕呼叫該表單自己的 `reset*Form()`、送出才真正執行 `PUT`／`DELETE`。之後如果要加第四個類似的表單，直接照抄這個結構就好，不用重新設計。
- 股票代碼輸入框是用 `class="uppercase"`（CSS 的 `text-transform`，純顯示用）來呈現大寫，而不是在輸入時即時竄改輸入框的實際值。
