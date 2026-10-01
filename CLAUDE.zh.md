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

**Node 版本很重要**：WSL 裡用的 Node 是 `/usr/local/bin/node`，由 `n` 管理（升級用 `n install 22`）；`/usr/bin/node` 是 apt 裝的古老 v12，跟這個專案無關，不要用。**Node v22.7.0 這個版本**有一個 JIT 的 bug：程式跑久、被最佳化之後，`Buffer.from(str, 'utf8')` 跟 HTTP 回應內容會把 `é` 這類字元輸出成 Latin-1 而不是 UTF-8——所以伺服器跑一陣子之後，帶重音的公司名稱（`Latécoère`、`Telefônica`）在網頁上會變成 `�`，但資料庫裡其實是對的；批次腳本則會把真正的 U+FFFD 寫進資料庫。`db.js`（伺服器跟每支腳本都會載入）現在遇到 v22.7.0 會直接拒絕執行，`package.json` 也宣告了 `engines: >=22.8.0`。以後如果重音文字又看起來是亂碼，先查資料庫實際存的位元組（`encode(convert_to(欄位,'UTF8'),'hex')`），再決定要不要「修資料」。

### 資料庫

`sql/schema.sql` 是資料庫結構的唯一依據，寫法上刻意讓它可以重複執行而不出錯（`CREATE TABLE IF NOT EXISTS`、`ADD COLUMN IF NOT EXISTS`、`DROP CONSTRAINT IF EXISTS` 後再重建）——沒有用遷移（migration）框架，異動 schema 就是直接重跑這個檔案：

```bash
psql -h localhost -U <role> -d <db> -f sql/schema.sql
```

PostgreSQL 是在 WSL 本機執行。App 是透過 TCP（`localhost:5432`）用密碼驗證的專用帳號連線，不是用 `postgres` 超級使用者，也不是 peer 驗證——連線設定來自 `.env`（可參考 `.env.example`），由 `db.js` 讀取。`.env` 裡還有一個 `SEC_EDGAR_CONTACT`，只有 `scripts/fill-cusip.js`（見下方）會用到，放在它對 SEC EDGAR 發請求時 `User-Agent` 裡的必要聯絡資訊。

### Git

這個 repo 的 `origin` 是 https://github.com/victor5566/update_stock_app（分支 `main`）。現在兩邊都能推送。Windows 端的 git 用 Git Credential Manager 快取的 HTTPS 憑證。WSL（使用者 `root`）有自己的 SSH 金鑰（`/root/.ssh/id_rsa`，RSA 4096，2026-10-01 已加到 victor5566 的 GitHub 帳號），加上一條只在 WSL 生效的全域規則 `url."git@github.com:".insteadOf "https://github.com/"`，所以 WSL 會自動把同樣的 `https://` remote 網址改走 SSH。Windows 也有 SSH 金鑰（`C:\Users\victo\.ssh\id_rsa`，RSA 4096，2026-10-01 已加到 GitHub），但 Windows 的 git 仍用 HTTPS——`origin` 維持 `https://` 網址，兩邊都不用各自設定 remote 就能用（`.git` 是共用的）。另外有第二個 remote `levelfields`（https://github.com/infocast-tw/LevelFields，分支 `dev`，透過本機的 `levelfields-dev` 分支合併），但 Claude Code 的自動模式會把推送到那裡判定為資料外流而擋下，即使使用者在對話中同意也一樣——這個推送由使用者自己執行。

### 例行資料維護

資料會隨時間漂移（改名、換代碼、下市、代碼被重新分配），沒有任何單一來源能全部抓到——尤其 Yahoo 對被重新分配的代碼會停留在舊資料。實際可行的流程：
1. 網頁的重新檢測按鈕（或 `check-stock-status.js` + `apply-update-candidates.js`）：處理 Yahoo 上名稱／市場的變動，改名需有 NASDAQ Trader 佐證。
2. `node scripts/audit-stocks.js`，然後人工審閱 `exports/audit-report.csv`（已加入 gitignore——每次執行都會重新產生）：代碼更換、下市、Yahoo 也跟著錯的名稱。套用前逐一用 Yahoo 最後交易日／依公司名稱搜尋新代碼確認；透過 `applyStockUpdate` 套用，下市用 `isdelisted` 標記。
3. 用 `fill-company-details.js`／`fill-cusip.js` 補缺漏。代碼被重新分配過的股票，對 quantumonline 查到的 CUSIP 要存疑。
4. 跑 `export-to-csv.js` 並 commit `exports/stocks.csv`。

## 架構重點

**`stocks`** 是核心資料表（`stock_symbol` 唯一、`company_name`、`exchange` 改為自由文字——不再限制四種市場、`source` 限制在 `manual | yahoo | excel_import | nasdaq_trader`），另外還有一批公司詳細資訊欄位：`isdelisted`（布林，預設 false——已停止交易的股票設為 true，*取代*刪除，所以可以復原、歷史記錄也會保留；見 `audit-stocks.js`）、`category`、`cusips`、`sector`、`industry`、`currency`、`company_location`、`urll`、`description`、`ceo`。這些欄位全部可為空、非必填，而且刻意**不放進**網頁的新增／編輯表單本身（那個表單一直都只「送出」`stock_symbol`／`company_name`／`exchange`，跟以前一樣沒變）——但現在手動新增之後，過一下子就會自動填好；見下面 `POST /api/stocks` 那段說明。`category` 完全沒有任何自動來源，只能手動／直接改資料庫。`currency` **一律是 `USD`**（使用者確認）：這裡每一檔股票都在美國市場交易，所以 `sql/schema.sql` 把它設成欄位預設值，`lib/fillCompanyDetails.js`／`lookupStock` 也都寫入 `USD`，不採用 Yahoo 的值——因為詳細資訊走外國掛牌備援時，Yahoo 的幣別會跟著外國掛牌走（ULUCF 從 RME.V 拿到了 CAD）。`stocks` 底下掛了五張輔助表：
- `company_name_history` / `stock_symbol_history` ——異動歷史的 append-only 記錄，寫入時包在交易（transaction）裡，`stock_id` 設定 `ON DELETE CASCADE`（股票被刪除後，歷史也會跟著消失）。
- `stock_update_candidates` / `stock_removal_candidates` ——這是「快照」不是「日誌」：`lib/checkStockStatus.js`（由 `scripts/check-stock-status.js` 或網頁的重新檢測按鈕執行）每次執行都會先 `TRUNCATE` 再整批重新寫入這兩張表；按鈕接著會套用並清空更新候選。也是 `ON DELETE CASCADE`，所以如果刪除一支剛好在「移除候選清單」裡的股票，它會自動從清單消失。
- `stock_deletion_log` ——唯一的例外：**刻意不設外鍵**，因為這張表的資料本來就是要在股票本身被刪除之後還留著。

**兩個「比對並記錄」的交易邏輯是最重要、最不直覺的機制**：
- **更新**：`lib/applyStockUpdate.js` 是共用的核心邏輯——先 `SELECT ... FOR UPDATE` 鎖定目前的資料列，執行更新，再比對更新前後的 `company_name`／`stock_symbol` 差異，視情況寫入前述兩張歷史表。它預期是在「呼叫端」自己開好的交易裡執行（呼叫端自己負責 `BEGIN`／`COMMIT`／`ROLLBACK` 跟 `client.connect`／`release`）。目前有兩個呼叫端在用：`PUT /api/stocks/:id`（網頁表單，一次一筆）跟 `scripts/apply-update-candidates.js`（批次套用，從 `stock_update_candidates` 一筆一筆處理）。之後如果要新增第三種更新股票的方式，請直接呼叫這個函式，不要重新寫一次比對邏輯。
- **刪除**：`DELETE /api/stocks/:id`（`routes/stocks.js`）刪除該筆資料（用 `RETURNING` 取回內容），並在同一個交易裡把內容寫進 `stock_deletion_log`。目前只有一個呼叫端，所以還沒抽成 `lib/` 共用函式。

之後如果要修改股票更新或刪除的邏輯，一定要保留這些步驟，因為歷史表／紀錄表的資料完全靠它們產生。兩條路徑寫入歷史表之前，都會把文字用 `Buffer.from(str,'utf8').toString('utf8')` 處理過一輪（見下面 `lib/sanitizeText.js`）。

**`source` 欄位是用來追蹤資料來源**，不只是留紀錄用：網頁上的「新增紀錄（手動輸入）」區塊，其實就是呼叫 `GET /api/stocks?source=manual`。只有 `POST /api/stocks`（網頁的新增表單）會把 `source` 設成 `'manual'`；各支匯入腳本各自會標記自己的來源值。之後如果新增其他寫入股票資料的方式，務必正確設定 `source`，否則會悄悄污染「手動新增紀錄」清單。

**路由**（`routes/*.js`）各自掛載在 `server.js` 裡不同的路徑前綴下（`/api/stocks`、`/api/company-name-history`、`/api/stock-symbol-history`、`/api/removal-candidates`、`/api/stock-deletion-log`）。`routes/stocks.js` 也提供 `GET /api/stocks/by-symbol/:symbol`，前端每個「先查詢再操作」的流程都靠這支 API（修改公司名稱／修改股票代碼／依代碼刪除，三個表單都是）——這些表單刻意使用文字輸入框＋共用的 `#stock-datalist` 自動完成，而不是 `<select>` 下拉選單（這是先前在這個專案裡依照回饋改回來的設計）。`GET /api/stocks/:id`（限數字 id）回傳包含所有詳細資訊欄位的完整資料列。`GET /api/stocks/yahoo-lookup/:symbol` 是給新增表單自動帶入用的唯讀 `lookupStock` 包裝（Yahoo 查不到回 404）。`routes/removalCandidates.js` 另外提供 `POST /refresh` 跟 `GET /refresh-status` 給「重新檢測」按鈕用（見下面 `check-stock-status.js`）。`POST /api/stocks` 遇到重複的 `stock_symbol` 會回 409（真正擋住重複的是資料庫的 UNIQUE 限制；前端送出前也會先比對已載入的清單）。`routes/stocks.js` 的 `PUT`／`POST` 如果 request body 裡有帶延伸詳細欄位也會接受，但目前前端沒有任何地方會這樣送——這條路留著是為了完整性，不代表現在有東西真的這樣呼叫。

**`POST /api/stocks` 會在後台自動補齊延伸詳細資訊。**當手動新增本身沒有帶任何延伸詳細欄位時（一般情況都是如此——網頁表單從來不會帶），`routes/stocks.js` 會先立刻回傳剛新增的那筆資料（新增本身維持同步、不會變慢），然後才透過 `autoFillNewStock()` 用「射後不理」（fire-and-forget）的方式，同時（`Promise.allSettled`，其中一個失敗不會擋住另一個）啟動 `lib/fillCompanyDetails.js` 跟 `lib/cusipLookup.js`，把批次腳本原本要手動跑才會產生的資料抓回來寫入。任何錯誤只會 `console.error` 到伺服器端，不會回傳給前端使用者看——自動補資料失敗的話，那些欄位就維持 `null`，跟腳本還沒跑過一樣，之後 `scripts/fill-company-details.js`／`scripts/fill-cusip.js`（兩支預設都是抓「還缺資料」的那些列）下次執行時還是會抓到。如果之後要加一個批次新增的路徑（例如某個匯入腳本）也想要這個行為，請針對每一列刻意呼叫類似 `autoFillNewStock` 的邏輯——不要讓一個批次迴圈同時觸發幾百個，因為 `lib/cusipLookup.js` 會打兩個有速率限制的外部服務。

**`lib/yahoo.js`** 集中管理 `yahoo-finance2` 的 client。`lookupStock(symbol)` 回傳 `stock_symbol`／`company_name`／`exchange`（透過 `marketLabelForQuote(quote)`，把 Yahoo 比較細的寫法如 `NasdaqGS`／`NYSE American`／`OTC Markets OTCPK` 收斂成資料表其他地方用的簡稱 `NASDAQ`／`NYSE`／`AMEX`／`OTC`——先用 `EXCHANGE_TO_MARKET` 對交易所代碼，對不到再用名稱樣式比對，都認不得的就照 Yahoo 的 `fullExchangeName` 原樣保留。`lib/checkStockStatus.js` 也用同一個函式比對，所以這些細分寫法不會被當成 `exchange_mismatch`（而且交易所上市的股票，本來就以 NASDAQ Trader 的交易所為準、蓋過 Yahoo——見下方狀態檢查的說明）。仍然是自由文字，不是驗證關卡），另外還有 `fetchCompanyDetails()` 盡力抓到的延伸欄位（`sector`、`industry`、`currency`、`company_location`、`urll`、`description`、`ceo`——透過 `quoteSummary` 的 `assetProfile`／`price` 模組；`ceo` 是從 `companyOfficers` 裡比對職稱含「CEO」或「Chief Executive」抓出來的；`company_location` 現在是從 `assetProfile` 的 `address1`／`address2`／`city`／`state`／`zip`／`country` 組出來的完整郵寄地址，不只是國家——由模組內部的 `composeAddress()` 處理，缺哪個欄位就跳過，因為非美國地址通常沒有 `state`）。`fetchCompanyDetails` 不會拋出例外——`quoteSummary` 查詢失敗時（例如非股票類型的證券）只會讓這些欄位維持 `null`，不會讓整個查詢失敗。Yahoo 這幾個模組完全不提供 CUSIP（那是 CUSIP Global Services 授權的資料，一般免費金融 API 不會轉發——連 OpenFIGI 都刻意排除這個欄位）。

**股票代碼格式：一律經過 `toYahooSymbol()`。**我們的代碼沿用交易所／NASDAQ Trader 對股票類別和 SPAC 證券的寫法（`BRK.B`、單位 `KCA.U`、認股權證 `NE.W`、認購權 `CELG.R`）；Yahoo 的寫法是 `BRK-B`、`KCA-UN`、`NE-WT`、`CELG-RI`。用我們的寫法查 Yahoo 會查不到——以前因此有約 150 檔還在交易的股票被列進移除候選，詳細資訊和 CUSIP 也補不到。`lib/yahoo.js` 的 `toYahooSymbol()` 負責轉換；所有 Yahoo 呼叫（`lookupStock`、`fetchCompanyDetails`、`lib/checkStockStatus.js` 的批次報價與結果對回）都會用它，`lookupStock` 回傳的代碼則維持*我們的*寫法。SEC 的 `company_tickers.json` 也用同樣的 dash 寫法（所以 `lib/cusipLookup.js` 查 CIK 時會轉換），但 quantumonline.com 用的是我們的 dot 寫法——那邊不要轉。

**`fetchCompanyDetails(symbol, companyName)` 的外國掛牌備援機制**：很多美股冷門 OTC 代號其實是外國公司的次要／交叉掛牌——例如 `ULUCF`（Roland Mineral Enterprises Corp.，OTC Pink）用這個代號在 Yahoo 上完全查不到任何資料，但同一家公司在加拿大 TSX Venture Exchange 掛牌代號是 `RME.V`，Yahoo 上有完整資料。所以當直接用代號查 `quoteSummary(symbol)` 完全查不到（而且有帶 `companyName`——不是每個呼叫端都會給）時，`findAlternateSymbol()` 會呼叫 Yahoo 的 `yf.search(companyName)`，取第一個 `EQUITY` 類型的結果，並用 `lib/normalizeCompanyName.js` 的 `companyNamesMatch()`（會先去掉標點符號／公司類型後綴等雜訊）確認名稱吻合才會採用——比對不上或沒有結果就當作「查不到」，絕不用猜的。「查不到」指的是沒有*公司簡介資料*——只有幣別不算，因為 Yahoo 的 `price` 模組連只有空殼的 OTC 代碼都會回傳幣別（CHCRF／Cheelcare 只回了「USD」，以前被當成有找到，結果跳過了備援，沒去抓它在 TSXV 的 CHER.V）。走備援時，如果原代碼有幣別就保留原代碼的幣別。這個備援機制只用在公司詳細資訊，CUSIP 查詢（`lib/cusipLookup.js`）不會用，因為那是綁在原本那個代號的特定申報文件／頁面上，不是綁在公司本身。

**`lib/fillCompanyDetails.js`** 把 `fetchCompanyDetails` 加上 `UPDATE stocks SET sector = ..., ...` 這段寫入（寫入前會先用下面的 `lib/sanitizeText.js` 清洗文字欄位）包成一個 `fillCompanyDetails(pool, stock)` 函式，回傳有沒有真的寫入東西。`UPDATE` 每個欄位都用 `COALESCE(新值, 原值)`，所以 Yahoo 這次剛好沒回傳的欄位會保留原本存的值，不會被清成 null。`scripts/fill-company-details.js`（批次回填）跟上面 `POST /api/stocks` 的自動補資料共用這個函式，兩條路徑才不會走歪掉。

**`lib/cusipLookup.js`** 把「先查 SEC EDGAR、查不到再查 quantumonline.com」這整套 CUSIP 查詢邏輯（來源細節見下面 `scripts/fill-cusip.js`）包成一個 `lookupCusip(symbol, { onSourceError })` 函式，回傳 `{ cusip, source }`。SEC 的代碼對 CIK 對照表（一個約 800KB 的檔案，不太會變）在同一個程序生命週期內只會抓一次、快取起來。`scripts/fill-cusip.js` 跟上面 `POST /api/stocks` 的自動補資料共用這個函式。它的設計受兩個過去的 bug 影響：
- **只採用 `SUBJECT COMPANY` 標頭 CIK 是這家公司本身的 13G。**一家公司在 EDGAR 的申報清單裡，也包含它以*持有人*身分申報其他公司的 13G；舊程式直接拿最新一份，結果 JPM、GS、MS、BLK、AMGN、CMCSA、ARCC 等存到的都是別家公司的 CUSIP。申報編號開頭是公司自己 CIK 的（自己申報的）不下載直接跳過；最多檢查 `SEC_MAX_DOCS` 份文件。修正前寫入的資料由 `scripts/recheck-sec-cusips.js` 修復。
- **所有 SEC 請求都經過 `secFetch()`**，整個程序內每個請求間隔至少 `SEC_MIN_GAP_MS`——只開 4 個並行，SEC 就回 HTTP 429，而且會封鎖約 10 分鐘。
- quantumonline 查無資料的頁面寫的是 `Not Found!`；不要放寬成 `/not found/i`——銀行股的頁面會在真正的 CUSIP 旁邊出現「Not found in FDIC」。它的資料也可能過時（BLK 還是 2024 年改組前的 `09247X101`），而且它是用代碼查詢，代碼被重新分配後可能回傳*前一個*發行人的 CUSIP（FGC）——不要只因為值不同，就用 quantumonline 的結果覆蓋已存的 CUSIP。所以 `lookupCusip(symbol, { companyName })`——只要知道公司名稱就要傳（新增時的自動補齊、`fill-cusip.js`、`recheck-sec-cusips.js` 都有傳）——只有在頁面上「Ticker Symbol:」前面的證券名稱包含 `companyName` 的第一個特徵字時，才採用 quantumonline 的 CUSIP；FGC 的頁面寫的是 NextEra Energy 的債券，所以對 FG Nexus 會被拒絕。

**`lib/validateCusip.js`** 實作了真正的 CUSIP 檢查碼演算法（`isValidCusip(value)`）——9 碼 CUSIP 的最後一碼是從前 8 碼算出來的檢查碼，所以不用查外部資料就能抓出打錯字的情況。`routes/stocks.js` 會用它擋掉 `POST`／`PUT` 裡格式不對的 `cusips`（回 400）；`lib/cusipLookup.js` 也會用它驗證任一來源解析出來的結果，回傳前先做一層保險。

**`lib/sanitizeText.js`** 就是那段 `Buffer.from(str,'utf8').toString('utf8')` 的處理，把外部 API 資料裡偶爾出現的無效／未配對 UTF-16 轉成合法的 UTF-8，不然 Postgres 會直接拒絕整個 `INSERT`／`UPDATE`，丟出「invalid byte sequence for encoding」的錯誤。`lib/applyStockUpdate.js`、`lib/checkStockStatus.js`、`lib/fillCompanyDetails.js` 都共用這個函式。開發自動補資料／批次回填腳本的初期，曾經因為這個 Postgres 錯誤悄悄遺失了 267 支股票的 Yahoo 資料；真正的原因很可能是上面「常用指令」提到的 Node v22.7.0 bug（程式跑熱之後 `Buffer.from` 輸出 Latin-1 位元組），而不是 API 文字本身有問題——在那個 Node 版本上，這段處理只是把錯誤變成存進資料庫的 `�`。之後新增會寫入外部 API 文字的路徑，還是要呼叫它，但真正的防線是不要用 v22.7.0。

**`lib/nasdaqTrader.js`** 載入 NASDAQ Trader 每日的代碼目錄（`代碼 -> { name（原始名稱）, exchange }`，保留 ETF、排除測試代碼），給 `lib/checkStockStatus.js` 跟 `scripts/audit-stocks.js` 用。`scripts/import-nasdaq-trader.js` 保留自己的解析器，因為它寫入時要排除 ETF。

**`lib/normalizeCompanyName.js`** 另外匯出跨來源比對用的函式：`issuerKey`（只取發行人的指紋：去掉括號內容、像「5.25% Senior Notes…」的票息條款、ADR／普通股／公司型態等描述字）、`isTruncationOf`（我們約 30 字的名稱是完整名稱在字中間被截斷的前綴）、`sameCompany`（以上任一成立或 `companyNamesMatch`）。問「兩個*來源*指的是不是同一個發行人」時用 `sameCompany`；問「名稱有沒有改」時還是用 `companyNamesMatch`。

**`lib/normalizeCompanyName.js`** 跟 **`lib/cleanSecurityName.js`** 是解決兩個不同問題的工具，不能互換：
- `normalizeCompanyName` 把名稱壓縮成一個「用來比較」的模糊指紋（先用 NFD + `\p{M}` 去掉重音符號、去掉*結尾的* ` New` 重新掛牌標記——只限結尾，不然「New Jersey」會出錯——再去除常見的公司後綴雜訊字（包含 Yahoo 在認股權證／單位／認購權後面加的 ` WT` 這類標記），最後去除所有空白——所以 `Telefonica` 跟 `Telefônica`、`GameStop Corporation` 跟 `GameStop Corp. WT` 都不算改名）——只有狀態檢查腳本會用到，用來判斷兩個名稱是不是「其實是同一個」（例如 NASDAQ Trader 的 "JP Morgan Chase & Co. Common Stock" 要能跟 Yahoo 的 "JPMorgan Chase & Co." 比對相同）。
- `cleanSecurityName` 是拿來產生「真的要顯示／寫入資料庫」的乾淨名稱，做法是去掉結尾的證券類型敘述（像是「 Common Stock」、「 - Class A Ordinary Shares」、「 Depositary Shares, each representing...」），但保留正常的空格排版——用在真正「寫入」`company_name` 的地方（`scripts/import-nasdaq-trader.js` 跟一次性腳本 `scripts/clean-company-names.js`），不是拿來比對用的。

**`scripts/`** 底下是幾支獨立的維護工具，直接連資料庫（各自都有自己的 `require('../db')` 跟 `dotenv.config()`），設計上就是要從命令列執行、跟正在跑的網頁伺服器無關——刻意不透過網頁介面或 API 對外提供（唯一的例外是 `check-stock-status.js`，見下方）：
- `add-from-yahoo.js SYMBOL...` ——查詢並新增指定的股票代碼。
- `import-from-excel.js <path.xlsx>` ——從 Excel 檔批次匯入（欄位標題用模糊比對辨識；同一代碼若出現多次，以較後面那筆為準）。
- `import-nasdaq-trader.js` ——下載 NASDAQ Trader 官方上市清單，批次匯入所有 NASDAQ/NYSE/AMEX 股票，匯入時會先用 `cleanSecurityName` 把名稱清乾淨。**不含 OTC**（官方上市清單本來就不包含 OTC 資料）；目前 OTC 的資料只來自 Excel 匯入。
- `clean-company-names.js` ——一次性的回填腳本，對資料庫裡每一筆現有資料重新跑一次 `cleanSecurityName`，名稱有變的就更新。**不會**寫入 `company_name_history`——這是資料品質修正，不是真正的改名，不應該被當成一次異動記錄下來。
- `check-stock-status.js` ——只是 `lib/checkStockStatus.js` 的命令列外殼；網頁「移除候選清單」的「重新檢測」按鈕也會透過 `POST /api/removal-candidates/refresh` 執行同一份邏輯（在背景執行、同時只跑一個、狀態存在程序記憶體裡；前端每 3 秒輪詢 `GET /api/removal-candidates/refresh-status`，跑完就重新載入清單——完整跑一次約 15–30 秒）。**按鈕檢測完之後會接著直接套用更新候選**，透過 `lib/applyUpdateCandidates.js`（跟 `apply-update-candidates.js` 同一份邏輯，所以改名一樣會寫進歷史表）——這是使用者的要求：重新檢測發現股票資訊有變，就要直接更新，不是只列出來。所以按鈕跑完後 `stock_update_candidates` 通常是空的；命令列腳本則仍然只做檢測。移除候選永遠不會自動套用。它把資料庫裡所有代碼分批（每批 200 筆）丟給 `yf.quote()` 查詢，並重建前述兩張候選清單表（每次都是先 `TRUNCATE` 再整批重新寫入，是「快照」不是累加）。呼叫 `yf.quote()` 時第三個參數要帶 `{}, { validateResult: false }`，否則一批 200 筆裡只要有一檔格式不符，整批都會被默默丟棄。**交易所上市股票不單獨信任 Yahoo 的名稱**：代碼被重新分配後，Yahoo 會繼續顯示*前一個*持有者的名稱（DPU 早就變成 Top KingWin 了，Yahoo 還是「DB Commodity Long ETN」；RCD 還顯示成 Invesco 的 ETF），而且我們的名稱大多原本就是從 Yahoo 抄來的，所以「Yahoo 跟我們一致」並不是獨立的確認。因此 NASDAQ/NYSE/AMEX 股票只有在 NASDAQ Trader 的上市清單（`lib/nasdaqTrader.js`）也跟 Yahoo 的新名稱一致（用 `sameCompany` 判斷）、而且跟我們現在的名稱不一致時，才會建議改名；不在清單裡的完全不建議改名。OTC 沒有第二個來源，所以仍然只看 Yahoo。少了這條規則，按鈕會把依官方清單修正過的名稱改回去。**交易所變更也遵循同一原則**（`corroboratedExchange`）：在清單裡的代碼以清單的交易所為準、忽略 Yahoo（Yahoo 把 EVV 標成 NYSE，實際是 NYSE American，按鈕還真的套用了）；交易所上市股票不在清單裡的，只接受改成 `OTC`；OTC 股票用 Yahoo。**出錯時也一律保守處理**：NASDAQ Trader 清單下載失敗時，該次 NASDAQ/NYSE/AMEX 股票*完全不*產生名稱／市場建議（絕不默默退回只看 Yahoo，因為按鈕會自動套用）；所有 Yahoo 批次都失敗時，`checkStockStatus` 會在 `TRUNCATE` 之前丟出錯誤，保留原本的候選清單。回傳結果帶有 `failedBatches`／`listingAvailable`，網頁和命令列都會顯示成警告。市場*和*名稱同時變更的股票，會產生一筆同時帶兩者的候選；出現在清單裡的 OTC 股票（已轉上市）採用清單的交易所。這些規則用 27 個情境的模擬測試驗證過（假的 Yahoo／清單／資料庫，在 require `lib/checkStockStatus.js` 之前先替換 `yf.quote` 和 `loadNasdaqTraderListing`），但只是臨時執行——專案沒有測試框架可以放；修改這些規則時請照這個方式重建測試。**移除候選也一樣**：在 NASDAQ Trader 清單裡的代碼，不管 Yahoo 怎麼說都不會列入移除候選——Yahoo 缺某些代碼（FBYDP、NE.A），也會把封閉式基金／小額債券標成 `ETF`（FSSL、SWZ、SCCD）。OTC 股票「Yahoo 查不到」只是很弱的證據：Yahoo 對小型 OTC 的涵蓋很差（ULUCF 2026-09-29 還有成交，Yahoo 上卻完全沒有）。OTC Markets 網站自己的後端（`https://backend.otcmarkets.com/otcapi/stock/trade/inside/<代碼>?symbol=<代碼>` 和 `.../company/profile/full/<代碼>?symbol=<代碼>`，需要帶類似瀏覽器的 `Origin`／`Referer: https://www.otcmarkets.com`）對已不存在的代碼回 404，否則會給最後成交／報價日期——整理 OTC 移除清單時是手動用它查的（每次間隔 500ms），但沒有寫進程式；這是非官方端點，要自動化之前先問使用者。修改這些規則之後**一定要重啟伺服器**——按鈕跑的是啟動時載入的程式碼，曾經有過舊程序一直在跑還沒加佐證規則的檢測程式。改名建議只用 Yahoo 的 `longName`，絕不用 `shortName`（那是 31 字元截斷，例如「Ocean Capital Acquisition Corpo」，或是縮寫）——按鈕會自動套用建議，錯的建議會直接弄壞 `company_name`。Yahoo 回傳的報價完全沒有交易所資訊時（BF.A 發生過），視為「未知」而不是 `exchange_mismatch`——`suggested_exchange` 是 NOT NULL，以前就因為這樣一筆讓整批寫入回滾。更新候選的原因現在是 `exchange_mismatch`（原本叫 `market_mismatch`）或 `company_name_mismatch`；移除候選只剩 `not_found_on_yahoo` 或 `no_longer_equity`——`unsupported_exchange` 這個原因已經不存在了，因為 `exchange` 現在是自由文字，沒有「不支援」這回事。每次大規模清理公司名稱之後，建議重跑這支腳本——名稱髒亂會讓 `company_name_mismatch` 候選清單出現大量誤判。
- `apply-update-candidates.js` ——`lib/applyUpdateCandidates.js` 的命令列外殼（跟重新檢測按鈕共用）。把 `stock_update_candidates` 裡的每一筆都透過 `applyStockUpdate` 套用回 `stocks` 表（所以還是會正常寫入歷史表），套用完就把該筆從候選表刪掉。只會動 `stock_update_candidates`；`stock_removal_candidates` 刻意不動，因為刪除股票是更嚴重的決定，網頁上就是留給人來判斷的。
- `fill-company-details.js [SYMBOL...]` ——透過上面提到的 `lib/fillCompanyDetails.js` 回填延伸詳細欄位。有給代碼就只處理那幾支；沒給就處理 7 個詳細欄位中*任何一個*是空的股票（不只看 `sector`——很多股票有產業別但缺執行長／簡介／地址）——現在手動新增的股票會自己觸發自動補資料（見上面 `POST /api/stocks` 那段），所以這支腳本主要是拿來補漏（例如當時 Yahoo 剛好沒資料、發生暫時性錯誤），或是回填透過網頁表單以外的方式新增的股票。
- `fill-cusip.js [SYMBOL...]` ——唯一不是查 Yahoo 或 NASDAQ Trader 的腳本：因為 CUSIP 這兩個來源都完全沒有，所以改用上面提到的 `lib/cusipLookup.js`，依序嘗試兩個來源：
  1. **SEC EDGAR**——每一份針對某公司申報的 Schedule 13G/13G-A 封面都會印出「CUSIP No. ...」，是美國政府的官方公開資料，完全沒有授權疑慮。做法是先透過 SEC 自己的 `company_tickers.json` 把代碼對應到 CIK，再用 `browse-edgar` 的 atom 輸出列出該 CIK 的 `SC 13G` 申報，抓最新一筆的完整申報 `.txt` 檔案，正規表示式解析出 CUSIP（會先把 `&nbsp;`／`&#160;` 跟 HTML 標籤處理掉，因為不同申報人排版習慣不同——開發過程中真的因此踩到一個 bug：MSFT 那份申報用 `&#160;`，修正正規表示式之前一直悄悄退回到第二個來源）。**一定要在 `.env` 設定 `SEC_EDGAR_CONTACT`**（真實可辨識的 email）——SEC 規定 `User-Agent` 沒帶聯絡資訊的自動化請求一律 403，見 https://www.sec.gov/os/webmaster-faq#developers；這裡的值要不要寫死，記得先問過使用者，因為每次請求都會把他們的聯絡資訊送給第三方。並不是每家公司都有 13G 申報（沒有任何機構持股超過 5% 門檻的話就不會有），這種查不到是預期行為，不是 bug。
  2. **quantumonline.com**——一個免費的公開證券查詢網站（`search.cfm?tickersymbol=<代碼>&sopt=symbol`），當作 SEC 查不到時的備援。沒有批次 API；檢查過它的 `robots.txt` 跟頁面內容，沒有找到明文禁止這樣查詢的條款，但畢竟是小網站——`QOL_DELAY_MS`（預設 500ms）會在每支代碼之間加上間隔，大量批次執行時請不要調低這個值。

  有給代碼就只處理那幾支；沒給就處理所有 `cusips IS NULL` 的股票。
- `recheck-sec-cusips.js [--apply]` ——一次性修復腳本，處理 `lib/cusipLookup.js` 還沒檢查 13G 標的公司之前寫入的 CUSIP（見上方）。對每檔有 CUSIP 又有 CIK 的股票，重現舊程式當時會用的那份申報；只有那份不是關於這家公司本身、*而且*目前存的 CUSIP 正好就是從那份錯誤申報抓出來的值時，才用修正後的邏輯重查並覆寫（可能寫成 null）——所以手動修正過的值（例如 JPM `46625H100`、BLK `09290D101`，quantumonline 的資料已過時）不會被蓋掉。循序執行、遇到 SEC 429 會等待重試，每修一筆就立刻寫入，中斷也不會失去進度。不加 `--apply` 只預覽。
- `audit-stocks.js [--out path.csv]` ——**唯讀**的交叉檢查：拿每一檔未標記下市的股票，比對 NASDAQ Trader 上市清單、SEC 的 `company_tickers.json` 跟 Yahoo，結果寫到 `exports/audit-report.csv`。能抓到只看 Yahoo 的狀態檢查抓不到的問題：代碼更換（我們的代碼從清單消失、同一家公司以我們沒有的代碼出現——例如 BRR→SVIA、DOMO→HUCK、HVII→ONEN；只是同一發行人的其他證券，像 `SBXD`→`SBXD-UN`，會由 `symbolRoot` 過濾掉）、下市、名稱被截斷、名稱不一致。名稱不一致只有在兩個來源彼此一致、卻跟我們不同時才會回報，因為單一來源的雜訊很多（格式差異、資料過時）。它的輸出需要人工審閱——腳本本身絕不寫入。這樣找到的代碼更換／改名要透過 `applyStockUpdate` 套用（才會記錄歷史），下市則是設 `isdelisted = true` 而不是刪除（可復原、保留歷史）；之後的稽核會略過 `isdelisted` 的股票。
- `export-to-csv.js` ——（格式放在 `lib/stockCsv.js`，跟股票列表的 **「匯出 CSV」按鈕**共用；按鈕會帶著列表目前的篩選條件呼叫 `GET /api/stocks/export.csv?market=&q=`——`routes/stocks.js` 的 `buildStockFilter()` 由列表和匯出共用，所以檔案內容永遠跟畫面上一樣；檔案帶 UTF-8 BOM，Excel 才能正確顯示重音字，檔名是 `stocks_<市場|all>[_<關鍵字>]_<日期>.csv`。公司簡介裡有換行、包在引號欄位中，所以算筆數要用 CSV 解析器，不能用 `wc -l`。）把整個 `stocks` 表（含所有詳細資訊欄位）匯出成 `exports/stocks.csv`（有加進版本控制，沒有被 gitignore）。這個檔案不會自動更新，資料庫有大量異動之後，如果想讓匯出檔保持最新，要自己重跑並重新 commit。

**前端**（`public/`）是多頁式、沒有 bundler 的架構：`index.html` 加 `app.js` 是主要的維護介面，`stock.html` 加 `stock.js` 則是獨立的單一股票詳情頁。之後要擴充時，請遵循已經在用的幾個模式：
- 多語系是用一個 `TRANSLATIONS` 物件（zh/en），透過 `data-i18n`／`data-i18n-placeholder` 屬性配合 `t()` 函式套用文字——不是用套件。`stock.js` 自己保留一份小型的同樣寫法，而不是共用 `app.js` 的物件，這跟這個專案一貫偏好「各頁各自複製」而非「抽共用元件」的風格一致。
- 每個列表區塊（股票列表、公司名稱異動記錄、股票代碼異動記錄、新增紀錄（手動輸入）、移除候選清單、已刪除股票紀錄——共 6 個）都是各自獨立做前端分頁，統一 `PAGE_SIZE = 15`，各自維護自己的分頁狀態跟渲染函式，沒有抽成共用的元件。這兩支歷史記錄的 API 以前有 `LIMIT 200`，加上分頁之後這個上限就拿掉了——之後不要在沒有同步處理前端分頁的情況下，又加回後端的筆數上限。
- 「先查詢再操作」的三個表單（改名、改代碼、刪除）都遵循同一套結構：代碼輸入框配 datalist 自動完成、一個「查詢」按鈕會呼叫 `by-symbol` 並解鎖／鎖住表單其餘欄位、一個「清空」按鈕呼叫該表單自己的 `reset*Form()`、送出才真正執行 `PUT`／`DELETE`。之後如果要加第四個類似的表單，直接照抄這個結構就好，不用重新設計。
- 股票代碼輸入框是用 `class="uppercase"`（CSS 的 `text-transform`，純顯示用）來呈現大寫，而不是在輸入時即時竄改輸入框的實際值。
- 新增／編輯表單（`#stock-form`）自從這個 app 加了延伸詳細欄位之後，內容完全沒變：還是只有 `stock_symbol`／`company_name`／`exchange`（最後一個現在是自由文字輸入框，搭配前端從現有清單動態產生的 `#exchange-datalist`，取代原本四選一的 `<select>`）。股票列表的**市場篩選**（`#market-filter`）正好相反：它是 `<select>`，第一個選項固定是「全部市場／All Markets」（`value=""`），後面每個現有市場一個選項，由 `populateStockDatalist()` 從完整、未篩選的清單重建。它以前也共用那個 datalist 輸入框，但一旦框裡是「OTC」，瀏覽器就只會建議符合「OTC」的值，不手動清空就回不到全部市場——不要再改回 datalist 輸入框。這個表單刻意**不**把延伸詳細欄位放成輸入框——伺服器會在手動新增後過一下子自動補上（見上面 `POST /api/stocks` 那段），所以剛新增的股票，`/<代碼>` 詳情頁在新增後一兩秒內就會自己填好，不用另外跑什麼。
- **單一股票詳情頁**：在股票列表（`public/app.js` 的 `renderTable`）裡點擊股票代碼，是一個普通的 `<a href="/<小寫代碼>">`，例如 `/aapl`——一個真正、可加書籤／分享的網址，不是 JS 彈出視窗。`server.js` 用一個 catch-all 路由 `app.get(/^\/[A-Za-z.-]{1,50}$/, ...)`（放在 `express.static` 跟 `/api/*` 路由後面，所以只有在沒有對到任何靜態檔案時才會觸發；它的正則只吃單一路徑段、不含斜線，所以不會蓋掉 `/api/*`）來處理，一律回傳 `public/stock.html`。那個頁面的 `stock.js` 直接從 `location.pathname` 讀出代碼，呼叫 `GET /api/stocks/by-symbol/:symbol`，把完整的公司資訊唯讀顯示出來；查無資料（404）就顯示「找不到」訊息。如果這支股票是 2 分鐘內新增的、`sector`／`cusips` 還是空的，頁面會每 3 秒重新抓一次（最多 10 次），背景自動補資料寫好之後不用手動重新整理就會出現——新增表單的成功訊息就是直接連到這裡。
- **新增表單自動帶入資料**：在新增模式下，輸入完股票代碼（`change` 事件——離開欄位或按 Enter，不是每打一個字）後，如果代碼已在清單裡，會先顯示重複警語（跟送出時一樣，附詳情頁連結）；否則呼叫 `GET /api/stocks/yahoo-lookup/:symbol` 帶入公司名稱跟交易市場。雖然路由名稱叫 yahoo，它套用的是狀態檢查的信任規則：代碼在 NASDAQ Trader 清單上時（`getCachedListing()`，快取 1 小時），交易所以清單為準，Yahoo 的名稱只有跟清單一致才採用（否則用清理過的清單名稱）——只看 Yahoo 會帶入代碼前一個持有者的名稱（DPU）。Yahoo 不回傳的上市代碼（被它標成 ETF 的封閉式基金）也能從清單帶入；回應的 `source`（`nasdaq_trader`／`yahoo`）會顯示在提示文字裡。
- **等價寫法的重複代碼**：`BRK-B`、`brk.b`、`BRK.B` 是同一檔證券（`lib/yahoo.js` 的 `symbolsEquivalent`），但 `UNIQUE` 限制只看完全相同的寫法。`routes/stocks.js` 的 `findEquivalentStock` 會在帶入查詢、`POST` 和 `PUT`（改代碼）時檢查，回 409 並附上 `existing_symbol`＝我們存的寫法，前端的重複警語會連到它。只有在欄位是空的、或者內容還是上一次查詢帶入的值時才會覆蓋，絕不會蓋掉使用者自己打的內容。按下「新增」之前不會寫入任何資料。
- **新增表單的訊息**：`#form-error` 顯示重複代碼警語（因為裡面有 `/<代碼>` 連結，是用 DOM 節點組出來的，不是 `innerHTML`），前端比對清單時跟收到 409 時都會顯示；`#form-hint` 顯示一般狀態——Yahoo 查詢進度，以及新增成功後的「已新增 X … 查看：X」，連到新股票的詳情頁。
