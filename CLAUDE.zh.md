# CLAUDE.zh.md

這份文件提供 Claude Code（claude.ai/code）在此專案中工作時所需的背景說明。為 [CLAUDE.md](CLAUDE.md) 的中文版，內容以英文版為準；若兩者不一致，請以 CLAUDE.md 為準。

## 專案簡介

一個股票代碼維護系統：後端是純 Node.js/Express（JSON API），前端是 `client/` 裡的 **React（create-react-app）+ Tailwind CSS**（由 `npm run build` 建置到 `client/build`，再由 Express 提供），資料存在 PostgreSQL。用途是維護股票代碼／公司名稱／交易市場清單——瀏覽、手動新增與修改、批次匯入、自動補公司資料與 CUSIP、以及自動偵測上市／下市狀態——不是交易或股價系統。

**資料放在別人的資料表裡。** 從 2026-10-06 起，系統讀寫的是遠端資料庫 `waffle_test` 裡既有的共用資料表 `test.company_profiles`（約 7.9 萬筆，涵蓋所有市場而非只有美股；約 4.4 萬筆標為下市）。使用者的要求：**絕不更改它的欄位，只能 SELECT / INSERT / UPDATE，不能 DELETE。** 登入帳號（`victor`）在任何 schema 都不能建表（`test`、`public` 都沒有 CREATE 權限），所以系統沒有自己的資料表。系統原本使用 WSL 本機資料庫，有 `stocks` 表和歷史紀錄、候選名單、刪除紀錄等表；那些功能（刪除、刪除紀錄、改名／代號歷史、手動新增紀錄、重新檢測與移除候選）在這次切換時移除了——若要恢復，請看切換前的 git 歷史（需要 DBA 建表；DDL 在 `sql/ddl_test_schema.sql`）。

## 常用指令

```bash
npm install
npm start          # node server.js
npm run dev         # node --watch server.js
npm run build       # 在 client/ 執行 npm ci（含 dev 套件），再 react-scripts build -> client/build
npm run dev:client  # CRA 開發伺服器 :3001（熱更新），/api 轉送到 :3000 的伺服器
npm test            # 前端的 Jest 測試（react-scripts test，不 watch）
```

除了 CRA 內建的 ESLint（建置／開發時顯示警告），沒有另外的 lint 指令。`npm run build` 會先安裝前端套件（`npm ci --prefix client --include=dev`，因為 `deploy/remote.sh` 用 `--omit=dev` 安裝根目錄，而 Tailwind 是前端的 devDependency），再把 React 應用程式建置到 `client/build`（不進 git）；每次部署都會執行它（`deploy/remote.sh` 在切換版本前，以及 `company_profiles` repo 的 GitHub Actions `deploy.yml`）。已經沒有另外的部署前檢查腳本——使用者在 2026-10-06 要求移除 `scripts/build.js`（Node 版本／語法／套件／UMD／UTF-16 `.env` 檢查），不要再加回來。壞掉的版本仍會被 `deploy/remote.sh` 的健康檢查擋下（而且 `db.js` 本身在 Node v22.7.0 上會拒絕啟動）。

**部署**：`deploy/setup-server.sh`（一次）、`deploy/deploy.sh [ref]`、`deploy/rollback.sh`——systemd 服務，版本放在 `/opt/stock-app`，伺服器有自己的 `shared/.env`，服務時區 `America/New_York`。手冊：`docs/Deployment_Guide_{zh-TW,en}.docx`。`company_profiles` repo 另外用自己的 `.github/workflows/deploy.yml` 部署（LXC 容器內的 PM2，push 到 main/dev/test 時觸發）。

**文件**（`docs/`，只有 Word 檔——使用者要 .docx，不要 Markdown 副本）：`Stock_System_Guide_{zh-TW,en}.docx`（安裝、網頁功能、偵測與 CUSIP 查詢的運作方式、命令列工具、欄位、疑難排解）和 `Deployment_Guide_{zh-TW,en}.docx`（`deploy/` 腳本、在伺服器上手動建置、company_profiles 的 GitHub Actions 流程）。中英文版結構相同。修改到安裝、介面、部署或文件描述的行為時，四份都要更新，並轉成 PDF 等方式檢查排版。最近一次重新產生是 2026-10-07，對應 create-react-app + Tailwind 前端。

整個專案在 WSL（Linux）中開發與執行，雖然專案資料夾實際放在 Windows 檔案系統（從 WSL 看是 `/mnt/c/Users/...`）。所有 `node`／`npm` 指令都要在 WSL shell 裡執行，不要用 PowerShell。從 Windows 連 `localhost:3000` 依賴 WSL 的 localhost 轉發，這個轉發曾經壞掉（沒有 `wslrelay` 在跑）；用 WSL 的 IP（`wsl hostname -I`）仍然可以連。

**Node 版本很重要**：WSL 裡用的 Node 是 `/usr/local/bin/node`，由 `n` 管理（升級用 `n install 22`）；`/usr/bin/node` 是 apt 裝的古老 v12，與本專案無關，不要用。**Node v22.7.0 這個版本**有 JIT bug：程式跑久之後，`Buffer.from(str, 'utf8')` 和 HTTP 回應內容會把 `é` 這類字元輸出成 Latin-1 而非 UTF-8——伺服器跑一陣子後帶重音的公司名稱（`Latécoère`、`Telefônica`）會顯示成 `�`，但資料庫其實是對的；批次腳本則會把真正的 U+FFFD 寫進資料庫。`db.js`（伺服器與每支腳本都會載入）遇到 v22.7.0 會拒絕執行，`package.json` 也宣告了 `engines: >=22.8.0`。如果重音文字又看起來是亂碼，先查資料庫實際存的位元組（`encode(convert_to(欄位,'UTF8'),'hex')`），再決定要不要「修資料」。

### 資料庫

連線設定來自 `.env`（不進 git；參考 `.env.example`），由 `db.js` 讀取：`PGHOST`／`PGPORT`／`PGUSER`／`PGPASSWORD`／`PGDATABASE`，加上 `PGSCHEMA=test`——`db.js` 會把它設成連線的 `search_path`，所有查詢都用不加 schema 的表名。`.env` 裡以註解保留了舊的本機資料庫設定。`HOST`（監聽位址，預設 `0.0.0.0`）由 `server.js` 讀取，它提供 API（`/api/stocks`、`/api/monitor`，以及 `GET /api/health`——不連資料庫的存活檢查，給 `deploy/remote.sh` 用）和前端（見下方）。前端用相對路徑 `/api` 呼叫 API。既有 `.env` 裡殘留的 `PUBLIC_URL` 會被忽略。WSL 的 IP 在 WSL 重啟或電腦重開機後可能改變。`.env` 也存放 `SEC_EDGAR_CONTACT`，是 SEC EDGAR 請求 `User-Agent` 必填的聯絡資訊（見 `lib/cusipLookup.js`）。

這個帳號不能讀大部分的 `pg_catalog`（`pg_namespace`、`pg_tables` → permission denied）；要查結構請用 `information_schema`、`has_*_privilege()` 和 `to_regnamespace()`。這也會讓某些悄悄用到 `pg_catalog` 的 SQL 失敗：**明確型別轉換（`$1::varchar`）和 `substring(x from y)` 會出現「permission denied for schema pg_catalog」**——不要用。另外，同一個參數若同時用在 `INSERT ... SELECT $1` 的值和 `WHERE` 比對裡，會出現「inconsistent types deduced for parameter」——改成把同一個值當兩個參數傳入（匯入腳本都這樣做）。

`company_profiles` 上有兩個 trigger：`company_profiles_audit`（新增／修改／刪除）和 `tr_updated_at_company_profiles`。稽核 trigger 會執行 `sandbox.audit_company_profiles()`，寫入 `sandbox.audit_company_profiles`——`victor` 連這個 schema 都看不到。在 DBA 開放權限（2026-10-06）之前，每次 INSERT／UPDATE 都失敗，錯誤是「permission denied for schema sandbox」（網頁新增時顯示 internal server error）；如果這個錯誤再出現，是這個權限的問題，不是程式。使用者的原則是只使用 `test`。`sql/schema.sql` 描述的是舊的本機結構，不會用在這個資料庫。

### Git

repo 的 `origin` 是 https://github.com/victor5566/update_stock_app（分支 `main`），Windows 和 WSL 兩邊都能 push。Windows 的 git 用 Git Credential Manager 快取的 HTTPS 憑證。WSL（使用者 `root`）有自己的 SSH key（`/root/.ssh/id_rsa`，RSA 4096，2026-10-01 加到 victor5566 GitHub 帳號），並有只在 WSL 生效的全域規則 `url."git@github.com:".insteadOf "https://github.com/"`，所以同樣的 `https://` remote 在 WSL 會自動走 SSH。Windows 也有 SSH key（`C:\Users\victo\.ssh\id_rsa`，RSA 4096，2026-10-01 加到 GitHub），但 Windows 的 git 繼續用 HTTPS——`origin` 請維持 `https://` 網址，兩邊都不必各自設定 remote（`.git` 是共用的）。第二個 remote 是 `company_profiles`（https://github.com/infocast-tw/company_profiles——由 `infocast-tw/LevelFields` 改名而來，remote 原名 `levelfields`；分支 `dev`，透過本地 `levelfields-dev` 分支合併）。**那個分支有 commit 進去的 `.env`**，所以 `git checkout levelfields-dev` 會默默蓋掉本機（gitignore 的）`.env`，切回 `main` 時又會把它刪掉——請先備份，或在另一個 `git worktree` 裡合併。Claude Code 的 auto mode 會把推送到那裡視為資料外流而擋下，即使使用者在對話中同意也一樣——那個 push 由使用者自己執行。

## 架構

**`lib/stockTable.js` 是唯一知道這張表細節的地方。** `TABLE`（`company_profiles`）、`ID`（`company_profile_id`）、`SELECT_COLUMNS`（把 `company_profile_id` 取別名為 `id`、`companysite` 取別名為 `urll`，讓 API 維持原本的欄位名稱）、`writeColumn()`（寫入時把 API 欄位名轉成實際欄位）、`isBlank()` 和 `PREFERRED_ORDER`。`routes/`、`lib/`、`scripts/` 的所有查詢都透過它們——不要在別處寫死表名或欄位名稱。

**這張表的資料特性**（影響下面多條規則）：
- `stock_symbol` **不是唯一的**（約 200 個代號有多筆）：代號被重用時，舊公司那筆會保留（`isdelisted = true`、`display_security = 'false'`），和新公司那筆並存。只知道代號時，用 `PREFERRED_ORDER`（未下市優先，再來 `display_security = 'true'`，再來 id 最新）選一筆。唯一索引 `idx_unq_company_profiles_stock_symbol` 建在 **`(stock_symbol, company_name)`** 上（這個帳號讀不到定義；2026-10-07 從 23505 的 `detail` 得知），所以新增和改名都可能遇到 23505 → 回 409「stock_symbol already exists」（例如 ADCT 上市中的 124802「Adc Therapeutics S.A.」不能改成「ADC Therapeutics SA」，因為已下市的舊資料 8837 就是這個名稱）；匯入腳本用 `INSERT ... SELECT ... WHERE NOT EXISTS`，而不是需要相符非部分約束的 `ON CONFLICT (stock_symbol)`。
- 代號涵蓋各市場：包含數字和 `. - _ ^ = &` 以及空白（`000001.SZ`、`3-Jun.DE`、`^GSPC`）；少數有大小寫混合（`ACIC_old`）。`routes/stocks.js` 的 `SYMBOL_PATTERN` 允許這些；查詢不分大小寫，也不會把已存的值轉大寫。新代號（新增、改代號）仍會轉大寫；編輯表單只在代號真的改變時才送出 `stock_symbol`，所以儲存大小寫混合的資料不會把它改名。
- `exchange` 約有 157 種自由文字值（NASDAQ、NYSE、OTC、PNK、LSE、Tokyo……），可能是 NULL 或 `''`。缺值普遍是 NULL 和 `''` 混用——`isBlank()`／`NULLIF(欄位, '')` 把兩者都當缺值。
- `currency` 有多種（USD、EUR、CNY、GBp……）。`fillCompanyDetails` 只在空白時才填入 Yahoo 的值——不再強制寫 `USD`（那是舊的美股專用表的規則）。
- `cusips` 可能有多個以空白分隔的值，同一個 CUSIP 也會出現在多筆（舊的下市資料＋目前的資料）。所以 `findCusipConflict` 會在清單內比對，並忽略已下市的資料。
- `isdelisted` 可以是 NULL（請用 `coalesce(isdelisted, false)`）。

**路由**：`routes/stocks.js`（掛在 `/api/stocks`）和 `routes/monitor.js`（掛在 `/api/monitor`，見下方股票偵測）。刻意**沒有 DELETE 路由**。
- `GET /` 在伺服器端分頁（`?page=&pageSize=`，最多 100；回傳 `{ rows, total, page, pageSize }`）——表太大不能整包送出，用戶端必須分頁讀取。`buildStockFilter()`（`?market=&q=`，`q` 會跳脫 LIKE 字元）與 `GET /export.csv` 共用，所以匯出內容就是篩選後的清單（全部頁）。
- `GET /markets`（所有不重複的市場值，例如給市場篩選或市場建議）和 `GET /suggest?q=`（依前綴列出 20 個代號，給代號自動完成——表太大不能預先載入）。
- `GET /by-symbol/:symbol`（不分大小寫；大小寫完全相同者優先，再依 `PREFERRED_ORDER`）和 `GET /:id` 都回傳 `SELECT_COLUMNS`，若有的話再加上程序內的自動補資料報告。
- `GET /yahoo-lookup/:symbol`——新增時的預填：先檢查是否已有未下市的資料（有就回 409 並附 `existing_symbol`），否則回傳公司名稱、市場和 `source`（`nasdaq_trader`／`yahoo`）。雖然路由叫 yahoo，但代號若在 NASDAQ Trader 清單上（`getCachedListing()`，快取 1 小時），以清單的市場為準，Yahoo 的名稱只有和清單一致時才採用——Yahoo 會保留代號前一家公司的名稱（DPU 曾回傳「DB Commodity Long ETN」）。不會寫入任何資料。
- `POST /`／`PUT /:id`——新增／修改。`PUT` 透過 `lib/applyStockUpdate.js`（一個 `UPDATE ... RETURNING`；已沒有歷史表——由資料表的稽核 trigger 記錄變更）。若新增其他修改股票的方式，請呼叫它，不要重寫欄位對應。

**重複**：`findEquivalentStock`（預填查詢、`POST`、`PUT` 改代號）把 `BRK-B`、`brk.b`、`BRK.B` 視為同一檔（`lib/yahoo.js` 的 `symbolsEquivalent`），而且只考慮**未下市**的資料，所以代號被重用時，新公司可以和舊的下市資料並存。回 409 並附 `existing_symbol`（實際存放的寫法，例如送 `BRK-B` 時回 `BRK.B`）。

**`POST /api/stocks` 會在回應前查詢公司資料，並說明缺了什麼。** 手動新增時若沒有自帶任何延伸欄位（正常情況——舊網頁表單從來不帶），`routes/stocks.js` 會先新增資料，再執行 `autoFillNewStock()`——同時跑 `lib/fillCompanyDetails.js` 和 `lib/cusipLookup.js`（`Promise.allSettled`，一個失敗不影響另一個）——並**等它完成**（使用者要求：新增後就要帶回所有查得到的資料，而不是之後才補），最多等 `ADD_LOOKUP_TIMEOUT_MS`（20 秒；超過就回 `autofill: { pending: true }`，查詢在背景繼續）。回應是重新讀取的資料加上 `autofill`，報告每部分的結果：`details` 為 `filled | not_found | error`，`cusip` 為 `filled | not_found | conflict | error`，並附 `lookupCusip` 各來源的 `reasons` 代碼（SEC `no_cik`／`no_13g`／`skipped_non_common`／`skipped_multi_class`……，quantumonline `not_found`／`name_mismatch`……）或已持有該 CUSIP 的 `conflict_symbol`，以及 `next_retry_at`／`retries_exhausted`。報告還在記憶體中時，`GET /:id` 和 `GET /by-symbol/:symbol` 也會回傳它，用戶端可以據此顯示缺資料的原因，並在 `next_retry_at` 之後重新讀取。`not_found`／`error` 會在 **1、5、15、60 分鐘後重試**（`AUTO_FILL_RETRY_MS`；先重新讀取資料，已補齊就停止）；CUSIP 衝突不重試——需要人工判斷。剛上市的股票在新增當下常常還不在資料來源裡（VYLR 新增時 Yahoo 沒有資料，幾小時後才有；新發行人在 SEC 還沒有 13G）。Yahoo 只回傳 `currency` 視為沒找到。報告和重試都在程序內，伺服器重啟就會消失，之後由 `scripts/fill-company-details.js`／`scripts/fill-cusip.js` 補上仍缺的資料。若新增批次匯入路徑也要有這種處理，請逐筆刻意執行——不要同時發出數百個，因為 `lib/cusipLookup.js` 會打兩個有速率限制的外部服務。

**股票偵測（`lib/stockMonitor.js`）**——使用者要求的自動「偵測並更新」程式：把每一筆資料（依使用者要求涵蓋所有市場）拿去比對 NASDAQ Trader 官方清單和 Yahoo 報價（每批 200 個，7.9 萬筆約 5 分鐘），**絕不刪除**。執行方式：透過 API（`POST /api/monitor/run { apply }`，輪詢 `GET /api/monitor/status`，明細由 `GET /api/monitor/report` 取得；狀態存在 `routes/monitor.js` 的程序內）、`scripts/monitor-stocks.js [--apply] [--list] [代號...]`（不加 `--apply` 只預覽），以及在 `.env` 設定 `MONITOR_DAILY_AT=HH:MM` 每日執行（目前設定 03:00 台北時間；`routes/monitor.js` 的 `scheduleDaily()`，那個時間伺服器必須在跑）。規則集中在純函式 `planRow(row, ctx)`（曾以 20 個假資料案例臨時驗證——修改規則時請重建一套）：
- 狀態：在官方清單上，或 Yahoo 最後成交 ≤ 30 天 → 上市；Yahoo 最後成交 ≥ 120 天 → 下市；NASDAQ/NYSE/AMEX 的一般代號，官方清單和 Yahoo 都沒有 → 下市；其他（交易稀少的 OTC、Yahoo 批次失敗、不在清單上的特別股）→ 無法判斷，不動。已下市的資料只有在目前名稱是同一家公司、且沒有其他未下市資料使用這個代號時才會改回上市（代號重用）。第一次預覽顯示約 2.6 萬筆要改回上市，其中約 2.3 萬筆是表中標為下市的非美股（可能是另一個系統的「不追蹤」）；使用者仍選擇涵蓋全部市場。
- 名稱：美國上市股需要官方清單與 Yahoo 一致；其他用 Yahoo 的 `longName`。佔位名稱（`324823`、`...missing co name`、`eo_company`、空白）一律替換。2026-10-06 起（使用者要求名稱越接近正確越好；一次預覽有 1,072 筆「名稱不一致」，大多是誤報），比對改為 `sameName = sameCompany || similarNames`（`lib/normalizeCompanyName.js`：忽略 ETF/ETN/Fund/Shares/Trust/Series/Index/Inc/Corp 等通用字，並把 Exchange-Traded Notes→ETN、U.S.→US、&→and、J.P.→JP、-3x→-3、Public Limited Company→plc 視為相同；一個字可以是另一個字的開頭，例如 NYLI／NYLIM）。官方清單與 Yahoo 一致才算確認；寫入的名稱用 Yahoo 的寫法（Yahoo 網頁上的乾淨名稱；「Roundhill ETF Trust - 」這類基金家族前綴在剩下部分與官方一致時去掉），只差大小寫的字用官方寫法（NVDA、MicroSectors），Yahoo 在字中間截斷時（「… ETF - Se」）用官方完整名稱。之後依序：上市股的資料庫名稱帶基金家族前綴、或是目前名稱的逐字縮寫（「Etracs Alerian Mlp Ind Ser B」）→ 更正；已確認 → 寫入；資料庫名稱在字中間被截斷而官方名稱接續它（「KKR ... LLC 4.」）→ 用官方完整名稱；Yahoo 與資料庫一致、官方名稱只是較簡略的寫法 → 不動；Yahoo 約 30 字的基金縮寫（「Brown Capital Mgmt Small Co Inv」）→ 不動（縮寫對不上時提示，可能是改名）；其他 → 提示。30／31 字的 Yahoo 名稱只有在結尾不像完整名稱時才視為截斷（Inc／Ltd／Limited／Association／Corp. III 等算完整）。只差 1～2 個字元的名稱（來源打錯字：「ETFo」「Holdlings」）一律不改。名稱相同但寫法不同、且已確認時，寫入來源的寫法（「Adc Therapeutics S.A.」→「ADC Therapeutics SA」），但若只會讓名稱變長超過 5 個字元則不改（「… ETF ETF Shares」、「Plc」→「Public Limited Company」）。`cleanSecurityName` 也多清除官方清單的描述字（「Ordinary Shares, no par value」「Subordinate Voting Shares」「Common Stock, $0.01 par value」「Common Units ...」「due January 8, 2038」「ADS」「ADR」「Unsponsored」「(New)」「D/B/A 」「X Trust Shares of Y」、名稱重複兩次）。驗證方式：同一份全表資料分別跑新舊 `planRow` 比較——舊程式會做的更正全部保留，提示 1,073 → 337，更正 26 → 249（逐筆檢查過）。`similarNames` 等新函式只有偵測的名稱規則使用；`sameCompany` 本身沒有改。
- 市場：官方清單的 NASDAQ/NYSE/AMEX 為準；Yahoo 顯示已改在 OTC 交易的美股 → `OTC`；非美股只補空白。`marketOf()` 會把 PNK/OEM/NYQ 等寫法歸一。
- Category（只處理 OTC）：Yahoo 的 `fullExchangeName - quoteSourceName - exchange`，例如 `OTC Markets OTCPK - PNK`／`OTC Markets OTCQX - Delayed Quote - OQX`；空白時填入，或既有的 `OTC Markets ...` 值層級／代碼不同時更新（quoteSourceName 時有時無，比對時忽略）。其他類型的 Category（`Domestic Common Stock`、`ETF`）不動。
- **改名會撞到唯一索引時**（同代號的另一筆已經是新名稱——ADCT）：依使用者要求，這一筆完全不動——不改任何欄位、不補公司資料／CUSIP——只留下說明 `name already used by another row with this symbol (id N[, delisted]): NAME - nothing changed`（分類 `nameTaken`）。在 `runStockMonitor`（不是 `planRow`）中對所有載入的資料檢查。
- 幣別只補空白。之後在寫入模式下才做：補公司資料（`fillCompanyDetails`），每次最多 `MONITOR_DETAIL_LIMIT`（300）筆缺資料的交易中股票；補 CUSIP，每次最多 `MONITOR_CUSIP_LIMIT`（50）筆交易中的美股——美股優先、最新的優先，所以每次執行會逐步補齊；CUSIP 查詢之間間隔 `QOL_DELAY_MS`（照顧 quantumonline）。`stock_symbol` 永遠不會被自動修改。
- **中止**：`POST /api/monitor/stop`會設定 `stopRequested`；`runStockMonitor` 的 `shouldStop()` 會在報價批次、每筆資料、補公司資料、補 CUSIP 之間檢查。在取得報價階段中止時**完全不寫入**（`stoppedDuringQuotes`）——用不完整的報價判斷，會把所有缺報價的股票誤判為下市。之後的階段中止時，已寫入的變更會保留；報告帶有 `stopped`，`counts.checked` 是實際處理的筆數。重啟伺服器也會結束執行（使用者第一次從舊網頁跑全表時，就是在 79,381 筆中約 2,500 筆時以重啟結束的）；命令列用 Ctrl+C 停止。
- 2026-10-06 第一次正式套用在使用者的 `Missing tickers.xlsx` 代號上（之前先用一次性腳本新增其中 308 檔資料庫沒有、且仍在交易的股票，名稱／市場規則與新增預填相同）。

**`lib/yahoo.js`** 集中管理 `yahoo-finance2` 用戶端。`lookupStock(symbol)` 回傳 `stock_symbol`／`company_name`／`exchange`（透過 `marketLabelForQuote(quote)`，把 Yahoo 較細的名稱如 `NasdaqGS`／`NYSE American`／`OTC Markets OTCPK` 收斂成 `NASDAQ`／`NYSE`／`AMEX`／`OTC`——先查 `EXCHANGE_TO_MARKET` 代碼，再用名稱比對，無法辨識的就直接用 Yahoo 的 `fullExchangeName`），以及 `fetchCompanyDetails()` 盡力取得的延伸欄位（`sector`、`industry`、`currency`、`company_location`、`urll`、`description`、`ceo`——來自 `quoteSummary` 的 `assetProfile`／`price` 模組；`ceo` 從 `companyOfficers` 中找職稱含 "CEO"／"Chief Executive" 的人；`company_location` 是 `composeAddress()` 組成的完整地址，缺的部分會略過）。`fetchCompanyDetails` 不會丟出錯誤——`quoteSummary` 失敗時欄位只會是 `null`。Yahoo 完全不提供 CUSIP（那是 CUSIP Global Services 的授權資料）。

**代號格式：一律透過 `toYahooSymbol()`。** 美股的股份類別和 SPAC 證券用交易所寫法（`BRK.B`、`KCA.U` 單位、`NE.W` 權證、`CELG.R` 權利）；Yahoo 寫成 `BRK-B`、`KCA-UN`、`NE-WT`、`CELG-RI`，用交易所寫法查 Yahoo 會查不到。`toYahooSymbol()` 只轉換單一字母的 `.X` 後綴，並且不動 `.T`／`.L`／`.V`／`.F`（`YAHOO_MARKET_SUFFIXES`——東京、倫敦、TSXV、法蘭克福，表中這些資料本來就是 Yahoo 格式），所以 `000001.SZ`、`7203.T`、`BARC.L` 會原樣通過。若有美股類別／證券用到這四個字母就不會被轉換——資料中沒看到。SEC 的 `company_tickers.json` 用破折號寫法（所以 `lib/cusipLookup.js` 查 CIK 時會轉換），但 quantumonline.com 用點的寫法——那裡不要轉換。

**`fetchCompanyDetails(symbol, companyName)` 的海外掛牌備援**：許多交易稀少的美國 OTC 代號其實是外國公司的交叉掛牌——`ULUCF`（Roland Mineral Enterprises）在 Yahoo 查不到，但同一家公司在 TSXV 以 `RME.V` 交易，Yahoo 有完整資料。直接查詢沒有拿到公司*簡介*時（只有幣別不算——CHCRF 只回傳 "USD"，曾因此跳過了它在 TSXV 的 CHER.V），`findAlternateSymbol()` 會執行 `yf.search(companyName)`，取第一個 `EQUITY` 結果，並要求名稱經 `companyNamesMatch()` 比對相符——比對不嚴謹或沒結果就視為「沒找到」，絕不猜測。只有公司資料用這個備援；CUSIP 查詢綁定原本的代號。

**`lib/fillCompanyDetails.js`** 把 `fetchCompanyDetails` 和 `UPDATE`（先清理文字）包成 `fillCompanyDetails(pool, stock)`，回傳是否有寫入。每個欄位用 `COALESCE(新值, 原值)`，所以 Yahoo 這次沒回傳的欄位會保留原值。由 `scripts/fill-company-details.js`、新增時的自動補資料和股票偵測共用。

**`lib/cusipLookup.js`** 把「先查 SEC EDGAR、再查 quantumonline.com」的 CUSIP 查詢包在 `lookupCusip(symbol, { companyName, listing, onSourceError })` → `{ cusip, source, reasons }`。SEC 的代號→CIK 對照表會在程序存活期間快取。由 `scripts/fill-cusip.js`、新增時的自動補資料和股票偵測共用。過去的 bug 形塑了它：
- **只採用 `SUBJECT COMPANY` 標頭的 CIK 是這家公司的 13G。** 公司的 EDGAR 清單裡也有它*以持股人身分*申報其他公司的 13G；舊程式曾為 JPM、GS、MS、BLK、AMGN、CMCSA、ARCC 等存入別家公司的 CUSIP。自己申報的文件不下載直接略過；最多檢查 `SEC_MAX_DOCS` 份文件。
- **所有 SEC 請求都經過 `secFetch()`**，全程序間隔 `SEC_MIN_GAP_MS`——SEC 對 4 個並行請求就回 429，之後封鎖約 10 分鐘。
- **只看標頭也不夠**：申報人會標錯對象（Norges Bank「關於」PLUG 的 13G 其實是 Rubrik），即使對象正確也會貼錯 CUSIP（GROY 有兩份 13G 印的是 NexGen 的）。所以封面的「(Name of Issuer)」必須與對象名稱或 `companyName` 相符，結果是**依發行人（前 6 碼）跨多份申報投票，再取該發行人最新的 CUSIP**——單純多數決曾選到分割前的號碼（SMCI、HTZ）。單獨的 1 比 1 不一致視為「沒找到」。`000000000` 這類佔位號碼會被 `isValidCusip` 擋下。
- **某些證券完全不查 SEC**（傳入 `lib/nasdaqTrader.js` 的 `listing` 才能判斷）：特別股／債券／權證／單位／權利（`isNonCommonSecurity`——SEC 把它們對應到母公司 CIK，而母公司的 13G 講的是普通股），以及多類別公司的任一類別（`hasCommonSibling`——FOX/FOXA、UHAL/UHAL.B）。這些由 quantumonline 處理，但它在重組後會過時（NWS/NWSA、LBTYA/B/K、BATRK、FWONA/FWONK 拿到的是重組前的 CUSIP）。
- **寫入前呼叫端必須執行 `findCusipConflict(pool, cusip, { stockId })`**：quantumonline 的頁面會出現別家公司的 CUSIP（CSQR 顯示 Copart 的、TELO 顯示 Outset 的），任何名稱比對都抓不到。其他未下市資料已持有的值不寫入（改為記錄）——不猜哪一邊才對。
- quantumonline 查無資料的頁面寫的是 `Not Found!`；不要放寬成 `/not found/i`——銀行頁面在真的 CUSIP 旁邊會有「Not found in FDIC」。它以代號為鍵，代號被重用時可能回傳*前一個*發行人的 CUSIP（FGC），所以只有頁面上的證券名稱包含 `companyName` 第一個有辨識度的字時才採用——只要知道 `companyName` 就要傳。
- SEC 只列 `SC 13G` 表單類型；2024 年底之後的申報改用結構化的 `SCHEDULE 13G`，這裡不讀。**需要 `SEC_EDGAR_CONTACT`**——SEC 會對沒有聯絡資訊的自動請求回 403；要寫死一個值之前請先問使用者，因為那是他們的聯絡資訊，會傳給第三方。quantumonline 是小網站：`QOL_DELAY_MS`（預設 500ms）控制批次間隔，不要調低。SEC 和 quantumonline 都只涵蓋美股——非美股會回「沒找到」，這是正常的。

**`lib/validateCusip.js`** 實作 CUSIP 檢查碼演算法（`isValidCusip`）；`routes/stocks.js` 在 `POST`／`PUT` 時以 400 拒絕格式錯誤的 `cusips`，`lib/cusipLookup.js` 用它檢查解析出來的值。

**`lib/sanitizeText.js`** 是 `Buffer.from(str,'utf8').toString('utf8')` 的來回轉換，把外部 API 偶爾出現的無效／不成對 UTF-16 轉成有效 UTF-8，再寫進 Postgres（否則整筆寫入會被拒絕）。由 `lib/applyStockUpdate.js` 和 `lib/fillCompanyDetails.js` 使用。過去曾因這個錯誤遺失 267 檔股票的資料，最可能的原因是 Node v22.7.0 的 bug，而不是 API 文字有問題——新的寫入路徑仍請呼叫它，但真正的保護是不要用 v22.7.0。

**`lib/nasdaqTrader.js`** 載入 NASDAQ Trader 每日的代號目錄（`symbol -> { name（原始名稱）, exchange }`），供新增預填、CUSIP 查詢、股票偵測和 `scripts/audit-stocks.js` 使用。**`lib/normalizeCompanyName.js`**（`normalizeCompanyName`——有損的比對指紋；`companyNamesMatch`；`issuerKey`／`isTruncationOf`／`sameCompany` 用來判斷「兩個來源是不是同一個發行人」）和 **`lib/cleanSecurityName.js`**（去掉結尾的 " Common Stock"／" - Class A Ordinary Shares" 等，產生顯示用名稱，以字詞邊界判斷，所以 "Curtiss-Wright" 不會被切掉）解決不同的問題——不要互換。

**`scripts/`** 是獨立的命令列工具，直接連 Postgres（各自 `require('../db')` + `dotenv.config()`），與伺服器是否在跑無關。全部使用 `lib/stockTable.js`；新增時遇到已存在的代號會跳過，而不是依賴 `ON CONFLICT`，也不再寫 `source` 欄位：
- `add-from-yahoo.js 代號...`——查詢並新增指定代號（已有未下市的同代號就跳過）。
- `import-from-excel.js <路徑.xlsx>`——從試算表批次新增（欄位標題寬鬆比對；同代號後面的列為準）。
- `import-nasdaq-trader.js`——新增 NASDAQ/NYSE/AMEX 清單中尚未存在的代號，名稱經 `cleanSecurityName` 清理。不含 OTC。
- `fill-company-details.js [代號...]`／`fill-cusip.js [代號...]`——用上述函式庫補資料。不指定代號時，會處理所有**未下市**且有空白欄位的資料——在這張表裡有數萬筆，很多是非美股（SEC/quantumonline 查不到），所以建議指定代號。
- `monitor-stocks.js [--apply] [--list] [代號...]`——在命令列執行股票偵測（見上方）。
- `audit-stocks.js [--out 路徑.csv]`——**唯讀**交叉比對未下市的 NASDAQ/NYSE/AMEX/OTC 資料（其他市場略過——來源不認得它們）與 NASDAQ Trader 清單、SEC 的 `company_tickers.json`、Yahoo，輸出 `exports/audit-report.csv`（不進 git）供人工檢查：代號變更、下市、名稱被截斷、名稱不符（只有兩個來源一致反對我們時才報）。依結果用 `applyStockUpdate` 修改；下市請設 `isdelisted = true`，絕不刪除。
- `export-to-csv.js`——把整張表匯出到 `exports/stocks.csv`（格式在 `lib/stockCsv.js`：實際欄位名稱，含 `companysite`，與 `GET /api/stocks/export.csv` 共用，會加 UTF-8 BOM 讓 Excel 正確顯示重音字）。約 7.9 萬筆含簡介，檔案約 9 MB，所以 `exports/` 已加入 gitignore——不要 commit。簡介中有換行（在引號內），計算筆數請用 CSV 解析器，不要用 `wc -l`。

**前端**（`client/`）——**create-react-app + Tailwind CSS**。2026-10-07 使用者要求整個前端打掉，用 `npx create-react-app` 重做（「讓之後網站可以擴充維護」），功能不變；之前的前端（原生 JS、不用 JSX 的 UMD React）都已移除。`client/` 是獨立的 npm 套件（`react-scripts` 5、React 19、`react-router-dom` 7、Tailwind CSS **v3** 為 devDependency——CRA 透過 PostCSS 自動讀取 `tailwind.config.js`；Tailwind v4 與 CRA 不相容，請維持 v3）。Tailwind 掃描 `src/**/*.{js,jsx}`，所以 **class 名稱必須寫成完整的字串**（不要 `'bg-' + color`）。Express 提供 `client/build`，所有非 `/api` 路徑都回傳其 `index.html`（尚未建置時回 503 文字）；未知的 `/api/...` 回 JSON 404，`GET /api/health` 是部署用的健康檢查。開發時同時執行伺服器（`npm run dev`）和 `npm run dev:client`（port 3001，CRA 的 `"proxy": "http://localhost:3000"` 轉送 `/api`）。npm 請在 WSL 執行（`node_modules` 與 Windows 共用）。結構（`client/src/`）：
- `index.js`：`BrowserRouter`，`/` -> `pages/HomePage.jsx`，`/:symbol` -> `pages/StockPage.jsx`。`index.css`：Tailwind 指令與 body 基本樣式。
- `translations.js`（`TRANSLATIONS`，zh/en，兩頁的字串）、`i18n.js`（`LangContext`／`useT()`／`useLang(titleKey)`；語言存在 `localStorage`，以 try/catch 包住）、`lib/stocks.js`（`API = '/api'`、`PAGE_SIZE`、`cx`、`stockHref()`、`autoFillProblems()`／`retryNote()`）、`lib/monitorCategories.js`（偵測結果分類，見下）。
- `components/ui.jsx`：Tailwind 介面元件（`Card`、`Button` 各種樣式、`Input`、`Select`、`Field`、`Alert` 各種色調、`Badge`、`Chip`、`StockLink`、`Table`／`TH`／`TD`、`Pagination`、`PageHeader`、`LangSelect`）。請重用這些元件，不要在各處另寫樣式，兩頁才會一致；深色模式用 Tailwind 的 `dark:`（跟隨作業系統）。面板：`StockListPanel`、`StockFormPanel`、`LookupEditForm`、`MonitorPanel`。
- 測試（react-scripts 的 Jest，`npm test`）：`translations.test.js`（中英文 key 一致）、`lib/monitorCategories.test.js`（說明字串的分類與翻譯）。
- `HomePage`：一個頁面分成數個分頁（`#list`、`#form`、`#edit`、`#monitor`，記在網址的 hash）。各分頁始終掛載、只是隱藏，所以填到一半的表單或執行中的偵測輪詢在切換分頁後仍保留。
  - **股票列表**：在伺服器端分頁（`fetchStocks({ keepPage, page, ...overrides })`，`PAGE_SIZE = 15`，用請求計數丟棄過期的回應）；搜尋（300 ms debounce）和市場篩選會回到第 1 頁；市場篩選是 `<select>`，不是 datalist 輸入框（datalist 裡是「OTC」時只會建議「OTC」——先前的回饋）；匯出 CSV 用相同篩選開啟 `GET /api/stocks/export.csv`。按「編輯」會切到表單分頁的編輯模式。
  - **新增／編輯表單**：代號輸入完成時（直接監聽 DOM 的 `change` 事件——React 的 `onChange` 每個按鍵都會觸發）呼叫 `yahoo-lookup`：409 就顯示重複警告並連到實際存放的寫法，否則預填名稱／市場，只覆蓋空白或仍是上次預填值的欄位。編輯模式只在代號真的改變時才送 `stock_symbol`（儲存大小寫混合的資料時才不會被改名）。新增後把 `autofill` 報告轉成原因清單和重試時間。
  - **修改資料**：三個「先查詢再修改」表單是同一個 `LookupEditForm` 元件，由 `LOOKUP_FORMS` 設定驅動（id、資訊欄位、新值欄位、相同值檢查、PUT 內容）——新增表單時在那裡加一筆設定。代號輸入框用 `#stock-datalist` 自動完成（每次輸入時從 `GET /suggest` 取得）；市場欄位的建議來自 `#exchange-datalist`。代號輸入框用 `uppercase` class（只影響顯示），不要改動輸入值。
  - **股票偵測**：預覽／偵測並更新（先確認）／中止（只在執行中顯示）；每 3 秒輪詢 `GET /api/monitor/status`，顯示進度條，載入 `GET /api/monitor/report` 的結果（有變更的排前面），每頁 15 筆；寫入型的執行結束後會重新整理列表和市場選項。結果可依分類篩選（`lib/monitorCategories.js` 的 `MONITOR_CATEGORIES`：自動變更——標為下市／恢復上市／名稱／市場／Category／幣別；需要注意——代號已被其他公司使用／代號重複／名稱不一致／其他說明；寫入失敗），以帶筆數的按鈕顯示。說明文字是 `lib/stockMonitor.js` 的 `planRow()` 產生的英文字串，`lib/monitorCategories.js` 的 `NOTE_PATTERNS` 比對它們來分類並翻譯（`translations.js` 的 `monitorNotes`）——**修改 `planRow()` 的說明字串時，也要同步修改 `NOTE_PATTERNS` 和它的測試**，否則會落到「其他說明」且不會翻譯。
- `StockPage`：個股詳細頁（路由 `/:symbol`；有 `?id=` 就讀 `GET /api/stocks/:id`，否則用 `by-symbol`）。列表連結是 `/<小寫代號>?id=<company_profile_id>`，因為代號不唯一。頁面會顯示 `autofill` 說明，並在 `next_retry_at` 之後重新讀取；新增不到 2 分鐘且仍缺 `sector`／`cusips` 的股票，每 3 秒重新讀取（最多 10 次）。
- 除了 Jest 測試，介面修改也用 headless Chrome（puppeteer-core）腳本對執行中的伺服器驗證，只做讀取（不實際送出成功的新增／修改，因為資料表是共用的；偵測結果以攔截請求模擬）。
