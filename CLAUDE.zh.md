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

PostgreSQL 是在 WSL 本機執行。App 是透過 TCP（`localhost:5432`）用密碼驗證的專用帳號連線，不是用 `postgres` 超級使用者，也不是 peer 驗證——連線設定來自 `.env`（可參考 `.env.example`），由 `db.js` 讀取。`.env` 裡還有一個 `SEC_EDGAR_CONTACT`，只有 `scripts/fill-cusip.js`（見下方）會用到，放在它對 SEC EDGAR 發請求時 `User-Agent` 裡的必要聯絡資訊。

### Git

這個 repo 的 `origin` 是 https://github.com/victor5566/update_stock_app（分支 `main`）。推送是在 Windows 端的 shell（PowerShell）執行，不是從 WSL——WSL 環境裡沒有設定 GitHub 登入資訊，但 Windows 端的 git 已經透過 Git Credential Manager 快取了這個帳號的憑證。

## 架構重點

**`stocks`** 是核心資料表（`stock_symbol` 唯一、`company_name`、`exchange` 改為自由文字——不再限制四種市場、`source` 限制在 `manual | yahoo | excel_import | nasdaq_trader`），另外還有一批公司詳細資訊欄位：`isdelisted`（布林，預設 false）、`category`、`cusips`、`sector`、`industry`、`currency`、`company_location`、`urll`、`description`、`ceo`。這些欄位全部可為空、非必填，而且刻意**不放進**網頁的新增／編輯表單本身（那個表單一直都只「送出」`stock_symbol`／`company_name`／`exchange`，跟以前一樣沒變）——但現在手動新增之後，過一下子就會自動填好；見下面 `POST /api/stocks` 那段說明。`category` 完全沒有任何自動來源，只能手動／直接改資料庫。`stocks` 底下掛了五張輔助表：
- `company_name_history` / `stock_symbol_history` ——異動歷史的 append-only 記錄，寫入時包在交易（transaction）裡，`stock_id` 設定 `ON DELETE CASCADE`（股票被刪除後，歷史也會跟著消失）。
- `stock_update_candidates` / `stock_removal_candidates` ——這是「快照」不是「日誌」：`scripts/check-stock-status.js` 每次執行都會先 `TRUNCATE` 再整批重新寫入這兩張表。也是 `ON DELETE CASCADE`，所以如果刪除一支剛好在「移除候選清單」裡的股票，它會自動從清單消失。
- `stock_deletion_log` ——唯一的例外：**刻意不設外鍵**，因為這張表的資料本來就是要在股票本身被刪除之後還留著。

**兩個「比對並記錄」的交易邏輯是最重要、最不直覺的機制**：
- **更新**：`lib/applyStockUpdate.js` 是共用的核心邏輯——先 `SELECT ... FOR UPDATE` 鎖定目前的資料列，執行更新，再比對更新前後的 `company_name`／`stock_symbol` 差異，視情況寫入前述兩張歷史表。它預期是在「呼叫端」自己開好的交易裡執行（呼叫端自己負責 `BEGIN`／`COMMIT`／`ROLLBACK` 跟 `client.connect`／`release`）。目前有兩個呼叫端在用：`PUT /api/stocks/:id`（網頁表單，一次一筆）跟 `scripts/apply-update-candidates.js`（批次套用，從 `stock_update_candidates` 一筆一筆處理）。之後如果要新增第三種更新股票的方式，請直接呼叫這個函式，不要重新寫一次比對邏輯。
- **刪除**：`DELETE /api/stocks/:id`（`routes/stocks.js`）刪除該筆資料（用 `RETURNING` 取回內容），並在同一個交易裡把內容寫進 `stock_deletion_log`。目前只有一個呼叫端，所以還沒抽成 `lib/` 共用函式。

之後如果要修改股票更新或刪除的邏輯，一定要保留這些步驟，因為歷史表／紀錄表的資料完全靠它們產生。兩條路徑寫入歷史表之前，都會把文字用 `Buffer.from(str,'utf8').toString('utf8')` 處理過一輪——帶重音符號的公司名稱（例如拉丁美洲的 ADR）之前就在這裡踩過 node-postgres 的編碼問題。

**`source` 欄位是用來追蹤資料來源**，不只是留紀錄用：網頁上的「新增紀錄（手動輸入）」區塊，其實就是呼叫 `GET /api/stocks?source=manual`。只有 `POST /api/stocks`（網頁的新增表單）會把 `source` 設成 `'manual'`；各支匯入腳本各自會標記自己的來源值。之後如果新增其他寫入股票資料的方式，務必正確設定 `source`，否則會悄悄污染「手動新增紀錄」清單。

**路由**（`routes/*.js`）各自掛載在 `server.js` 裡不同的路徑前綴下（`/api/stocks`、`/api/company-name-history`、`/api/stock-symbol-history`、`/api/removal-candidates`、`/api/stock-deletion-log`）。`routes/stocks.js` 也提供 `GET /api/stocks/by-symbol/:symbol`，前端每個「先查詢再操作」的流程都靠這支 API（修改公司名稱／修改股票代碼／依代碼刪除，三個表單都是）——這些表單刻意使用文字輸入框＋共用的 `#stock-datalist` 自動完成，而不是 `<select>` 下拉選單（這是先前在這個專案裡依照回饋改回來的設計）。`GET /api/stocks/:id`（限數字 id）回傳包含所有詳細資訊欄位的完整資料列。`routes/stocks.js` 的 `PUT`／`POST` 如果 request body 裡有帶延伸詳細欄位也會接受，但目前前端沒有任何地方會這樣送——這條路留著是為了完整性，不代表現在有東西真的這樣呼叫。

**`POST /api/stocks` 會在後台自動補齊延伸詳細資訊。**當手動新增本身沒有帶任何延伸詳細欄位時（一般情況都是如此——網頁表單從來不會帶），`routes/stocks.js` 會先立刻回傳剛新增的那筆資料（新增本身維持同步、不會變慢），然後才透過 `autoFillNewStock()` 用「射後不理」（fire-and-forget）的方式，同時（`Promise.allSettled`，其中一個失敗不會擋住另一個）啟動 `lib/fillCompanyDetails.js` 跟 `lib/cusipLookup.js`，把批次腳本原本要手動跑才會產生的資料抓回來寫入。任何錯誤只會 `console.error` 到伺服器端，不會回傳給前端使用者看——自動補資料失敗的話，那些欄位就維持 `null`，跟腳本還沒跑過一樣，之後 `scripts/fill-company-details.js`／`scripts/fill-cusip.js`（兩支預設都是抓「還缺資料」的那些列）下次執行時還是會抓到。如果之後要加一個批次新增的路徑（例如某個匯入腳本）也想要這個行為，請針對每一列刻意呼叫類似 `autoFillNewStock` 的邏輯——不要讓一個批次迴圈同時觸發幾百個，因為 `lib/cusipLookup.js` 會打兩個有速率限制的外部服務。

**`lib/yahoo.js`** 集中管理 `yahoo-finance2` 的 client。`lookupStock(symbol)` 回傳 `stock_symbol`／`company_name`／`exchange`（現在是 Yahoo 的 `fullExchangeName`，自由文字——`EXCHANGE_TO_MARKET` 只保留當作備援顯示用，不再是驗證關卡），另外還有 `fetchCompanyDetails()` 盡力抓到的延伸欄位（`sector`、`industry`、`currency`、`company_location`、`urll`、`description`、`ceo`——透過 `quoteSummary` 的 `assetProfile`／`price` 模組；`ceo` 是從 `companyOfficers` 裡比對職稱含「CEO」或「Chief Executive」抓出來的；`company_location` 現在是從 `assetProfile` 的 `address1`／`address2`／`city`／`state`／`zip`／`country` 組出來的完整郵寄地址，不只是國家——由模組內部的 `composeAddress()` 處理，缺哪個欄位就跳過，因為非美國地址通常沒有 `state`）。`fetchCompanyDetails` 不會拋出例外——`quoteSummary` 查詢失敗時（例如非股票類型的證券）只會讓這些欄位維持 `null`，不會讓整個查詢失敗。Yahoo 這幾個模組完全不提供 CUSIP（那是 CUSIP Global Services 授權的資料，一般免費金融 API 不會轉發——連 OpenFIGI 都刻意排除這個欄位）。

**`fetchCompanyDetails(symbol, companyName)` 的外國掛牌備援機制**：很多美股冷門 OTC 代號其實是外國公司的次要／交叉掛牌——例如 `ULUCF`（Roland Mineral Enterprises Corp.，OTC Pink）用這個代號在 Yahoo 上完全查不到任何資料，但同一家公司在加拿大 TSX Venture Exchange 掛牌代號是 `RME.V`，Yahoo 上有完整資料。所以當直接用代號查 `quoteSummary(symbol)` 完全查不到（而且有帶 `companyName`——不是每個呼叫端都會給）時，`findAlternateSymbol()` 會呼叫 Yahoo 的 `yf.search(companyName)`，取第一個 `EQUITY` 類型的結果，並用 `lib/normalizeCompanyName.js` 的 `companyNamesMatch()`（會先去掉標點符號／公司類型後綴等雜訊）確認名稱吻合才會採用——比對不上或沒有結果就當作「查不到」，絕不用猜的。這個備援機制只用在公司詳細資訊，CUSIP 查詢（`lib/cusipLookup.js`）不會用，因為那是綁在原本那個代號的特定申報文件／頁面上，不是綁在公司本身。

**`lib/fillCompanyDetails.js`** 把 `fetchCompanyDetails` 加上 `UPDATE stocks SET sector = ..., ...` 這段寫入（寫入前會先用下面的 `lib/sanitizeText.js` 清洗文字欄位）包成一個 `fillCompanyDetails(pool, stock)` 函式，回傳有沒有真的寫入東西。`scripts/fill-company-details.js`（批次回填）跟上面 `POST /api/stocks` 的自動補資料共用這個函式，兩條路徑才不會走歪掉。

**`lib/cusipLookup.js`** 把「先查 SEC EDGAR、查不到再查 quantumonline.com」這整套 CUSIP 查詢邏輯（來源細節見下面 `scripts/fill-cusip.js`）包成一個 `lookupCusip(symbol, { onSourceError })` 函式，回傳 `{ cusip, source }`。SEC 的代碼對 CIK 對照表（一個約 800KB 的檔案，不太會變）在同一個程序生命週期內只會抓一次、快取起來。`scripts/fill-cusip.js` 跟上面 `POST /api/stocks` 的自動補資料共用這個函式。

**`lib/validateCusip.js`** 實作了真正的 CUSIP 檢查碼演算法（`isValidCusip(value)`）——9 碼 CUSIP 的最後一碼是從前 8 碼算出來的檢查碼，所以不用查外部資料就能抓出打錯字的情況。`routes/stocks.js` 會用它擋掉 `POST`／`PUT` 裡格式不對的 `cusips`（回 400）；`lib/cusipLookup.js` 也會用它驗證任一來源解析出來的結果，回傳前先做一層保險。

**`lib/sanitizeText.js`** 就是那段 `Buffer.from(str,'utf8').toString('utf8')` 的處理，把外部 API 資料裡偶爾出現的無效／未配對 UTF-16 轉成合法的 UTF-8，不然 Postgres 會直接拒絕整個 `INSERT`／`UPDATE`，丟出「invalid byte sequence for encoding」的錯誤。`lib/applyStockUpdate.js`、`scripts/check-stock-status.js`、`lib/fillCompanyDetails.js` 都共用這個函式——這個問題在開發自動補資料／批次回填腳本的初期真的悄悄吃掉了 267 支股票的 Yahoo 資料（一開始那些寫入路徑沒做這段清洗），後來才被抓出來修掉，所以之後如果要新增一個會寫入外部 API 文字資料的路徑，不要漏掉這一步。

**`lib/normalizeCompanyName.js`** 跟 **`lib/cleanSecurityName.js`** 是解決兩個不同問題的工具，不能互換：
- `normalizeCompanyName` 把名稱壓縮成一個「用來比較」的模糊指紋（先去除常見的公司後綴雜訊字，再去除所有空白）——只有狀態檢查腳本會用到，用來判斷兩個名稱是不是「其實是同一個」（例如 NASDAQ Trader 的 "JP Morgan Chase & Co. Common Stock" 要能跟 Yahoo 的 "JPMorgan Chase & Co." 比對相同）。
- `cleanSecurityName` 是拿來產生「真的要顯示／寫入資料庫」的乾淨名稱，做法是去掉結尾的證券類型敘述（像是「 Common Stock」、「 - Class A Ordinary Shares」、「 Depositary Shares, each representing...」），但保留正常的空格排版——用在真正「寫入」`company_name` 的地方（`scripts/import-nasdaq-trader.js` 跟一次性腳本 `scripts/clean-company-names.js`），不是拿來比對用的。

**`scripts/`** 底下是幾支獨立的維護工具，直接連資料庫（各自都有自己的 `require('../db')` 跟 `dotenv.config()`），設計上就是要從命令列執行、跟正在跑的網頁伺服器無關——刻意不透過網頁介面或 API 對外提供：
- `add-from-yahoo.js SYMBOL...` ——查詢並新增指定的股票代碼。
- `import-from-excel.js <path.xlsx>` ——從 Excel 檔批次匯入（欄位標題用模糊比對辨識；同一代碼若出現多次，以較後面那筆為準）。
- `import-nasdaq-trader.js` ——下載 NASDAQ Trader 官方上市清單，批次匯入所有 NASDAQ/NYSE/AMEX 股票，匯入時會先用 `cleanSecurityName` 把名稱清乾淨。**不含 OTC**（官方上市清單本來就不包含 OTC 資料）；目前 OTC 的資料只來自 Excel 匯入。
- `clean-company-names.js` ——一次性的回填腳本，對資料庫裡每一筆現有資料重新跑一次 `cleanSecurityName`，名稱有變的就更新。**不會**寫入 `company_name_history`——這是資料品質修正，不是真正的改名，不應該被當成一次異動記錄下來。
- `check-stock-status.js` ——把資料庫裡所有代碼分批（每批 200 筆）丟給 `yf.quote()` 查詢，並重建前述兩張候選清單表（每次都是先 `TRUNCATE` 再整批重新寫入，是「快照」不是累加）。呼叫 `yf.quote()` 時第三個參數要帶 `{}, { validateResult: false }`，否則一批 200 筆裡只要有一檔格式不符，整批都會被默默丟棄。更新候選的原因現在是 `exchange_mismatch`（原本叫 `market_mismatch`）或 `company_name_mismatch`；移除候選只剩 `not_found_on_yahoo` 或 `no_longer_equity`——`unsupported_exchange` 這個原因已經不存在了，因為 `exchange` 現在是自由文字，沒有「不支援」這回事。每次大規模清理公司名稱之後，建議重跑這支腳本——名稱髒亂會讓 `company_name_mismatch` 候選清單出現大量誤判。
- `apply-update-candidates.js` ——把 `stock_update_candidates` 裡的每一筆都透過 `applyStockUpdate` 套用回 `stocks` 表（所以還是會正常寫入歷史表），套用完就把該筆從候選表刪掉。只會動 `stock_update_candidates`；`stock_removal_candidates` 刻意不動，因為刪除股票是更嚴重的決定，網頁上就是留給人來判斷的。
- `fill-company-details.js [SYMBOL...]` ——透過上面提到的 `lib/fillCompanyDetails.js` 回填延伸詳細欄位。有給代碼就只處理那幾支；沒給就處理所有 `sector IS NULL` 的股票（拿來當作「還沒回填過」的判斷依據）——現在手動新增的股票會自己觸發自動補資料（見上面 `POST /api/stocks` 那段），所以這支腳本主要是拿來補漏（例如當時 Yahoo 剛好沒資料、發生暫時性錯誤），或是回填透過網頁表單以外的方式新增的股票。
- `fill-cusip.js [SYMBOL...]` ——唯一不是查 Yahoo 或 NASDAQ Trader 的腳本：因為 CUSIP 這兩個來源都完全沒有，所以改用上面提到的 `lib/cusipLookup.js`，依序嘗試兩個來源：
  1. **SEC EDGAR**——每一份針對某公司申報的 Schedule 13G/13G-A 封面都會印出「CUSIP No. ...」，是美國政府的官方公開資料，完全沒有授權疑慮。做法是先透過 SEC 自己的 `company_tickers.json` 把代碼對應到 CIK，再用 `browse-edgar` 的 atom 輸出列出該 CIK 的 `SC 13G` 申報，抓最新一筆的完整申報 `.txt` 檔案，正規表示式解析出 CUSIP（會先把 `&nbsp;`／`&#160;` 跟 HTML 標籤處理掉，因為不同申報人排版習慣不同——開發過程中真的因此踩到一個 bug：MSFT 那份申報用 `&#160;`，修正正規表示式之前一直悄悄退回到第二個來源）。**一定要在 `.env` 設定 `SEC_EDGAR_CONTACT`**（真實可辨識的 email）——SEC 規定 `User-Agent` 沒帶聯絡資訊的自動化請求一律 403，見 https://www.sec.gov/os/webmaster-faq#developers；這裡的值要不要寫死，記得先問過使用者，因為每次請求都會把他們的聯絡資訊送給第三方。並不是每家公司都有 13G 申報（沒有任何機構持股超過 5% 門檻的話就不會有），這種查不到是預期行為，不是 bug。
  2. **quantumonline.com**——一個免費的公開證券查詢網站（`search.cfm?tickersymbol=<代碼>&sopt=symbol`），當作 SEC 查不到時的備援。沒有批次 API；檢查過它的 `robots.txt` 跟頁面內容，沒有找到明文禁止這樣查詢的條款，但畢竟是小網站——`QOL_DELAY_MS`（預設 500ms）會在每支代碼之間加上間隔，大量批次執行時請不要調低這個值。

  有給代碼就只處理那幾支；沒給就處理所有 `cusips IS NULL` 的股票。
- `export-to-csv.js` ——把整個 `stocks` 表（含所有詳細資訊欄位）匯出成 `exports/stocks.csv`（有加進版本控制，沒有被 gitignore）。這個檔案不會自動更新，資料庫有大量異動之後，如果想讓匯出檔保持最新，要自己重跑並重新 commit。

**前端**（`public/`）是多頁式、沒有 bundler 的架構：`index.html` 加 `app.js` 是主要的維護介面，`stock.html` 加 `stock.js` 則是獨立的單一股票詳情頁。之後要擴充時，請遵循已經在用的幾個模式：
- 多語系是用一個 `TRANSLATIONS` 物件（zh/en），透過 `data-i18n`／`data-i18n-placeholder` 屬性配合 `t()` 函式套用文字——不是用套件。`stock.js` 自己保留一份小型的同樣寫法，而不是共用 `app.js` 的物件，這跟這個專案一貫偏好「各頁各自複製」而非「抽共用元件」的風格一致。
- 每個列表區塊（股票列表、公司名稱異動記錄、股票代碼異動記錄、新增紀錄（手動輸入）、移除候選清單、已刪除股票紀錄——共 6 個）都是各自獨立做前端分頁，統一 `PAGE_SIZE = 15`，各自維護自己的分頁狀態跟渲染函式，沒有抽成共用的元件。這兩支歷史記錄的 API 以前有 `LIMIT 200`，加上分頁之後這個上限就拿掉了——之後不要在沒有同步處理前端分頁的情況下，又加回後端的筆數上限。
- 「先查詢再操作」的三個表單（改名、改代碼、刪除）都遵循同一套結構：代碼輸入框配 datalist 自動完成、一個「查詢」按鈕會呼叫 `by-symbol` 並解鎖／鎖住表單其餘欄位、一個「清空」按鈕呼叫該表單自己的 `reset*Form()`、送出才真正執行 `PUT`／`DELETE`。之後如果要加第四個類似的表單，直接照抄這個結構就好，不用重新設計。
- 股票代碼輸入框是用 `class="uppercase"`（CSS 的 `text-transform`，純顯示用）來呈現大寫，而不是在輸入時即時竄改輸入框的實際值。
- 新增／編輯表單（`#stock-form`）自從這個 app 加了延伸詳細欄位之後，內容完全沒變：還是只有 `stock_symbol`／`company_name`／`exchange`（最後一個現在是自由文字輸入框，搭配前端從現有清單動態產生的 `#exchange-datalist`，取代原本四選一的 `<select>`）。這個表單刻意**不**把延伸詳細欄位放成輸入框——伺服器會在手動新增後過一下子自動補上（見上面 `POST /api/stocks` 那段），所以剛新增的股票，`/<代碼>` 詳情頁在新增後一兩秒內就會自己填好，不用另外跑什麼。
- **單一股票詳情頁**：在股票列表（`public/app.js` 的 `renderTable`）裡點擊股票代碼，是一個普通的 `<a href="/<小寫代碼>">`，例如 `/aapl`——一個真正、可加書籤／分享的網址，不是 JS 彈出視窗。`server.js` 用一個 catch-all 路由 `app.get(/^\/[A-Za-z.-]{1,50}$/, ...)`（放在 `express.static` 跟 `/api/*` 路由後面，所以只有在沒有對到任何靜態檔案時才會觸發；它的正則只吃單一路徑段、不含斜線，所以不會蓋掉 `/api/*`）來處理，一律回傳 `public/stock.html`。那個頁面的 `stock.js` 直接從 `location.pathname` 讀出代碼，呼叫 `GET /api/stocks/by-symbol/:symbol`，把完整的公司資訊唯讀顯示出來；查無資料（404）就顯示「找不到」訊息。這個頁面不會自動重新整理，所以如果新增股票後馬上跳過去看（背景自動補資料還沒跑完），要手動重新整理才會看到補好的欄位。
