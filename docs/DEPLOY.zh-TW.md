# 部署手冊：Stock Symbol Manager 部署到遠端 Linux 伺服器

本手冊說明如何用 `deploy/` 目錄中的腳本，把網站部署到一台遠端 Linux 伺服器，並以 systemd 服務常駐執行。

## 1. 架構概要

```
本機 (WSL / Linux / macOS)                 遠端 Linux 伺服器
--------------------------                 -----------------------------------------
deploy/setup-server.sh  --ssh-->  一次性：安裝 Node、建立帳號/目錄/systemd 服務
deploy/deploy.sh        --ssh-->  /opt/stock-app/releases/<時間>-<commit>/  (新版本)
                                  /opt/stock-app/current -> 目前上線的版本 (symlink)
                                  /opt/stock-app/shared/.env  (伺服器自己的設定)
deploy/rollback.sh      --ssh-->  current 切回較舊的版本
```

- 程式碼以 `git archive` 上傳，**只部署已 commit 的內容**；未 commit 的修改不會上去。
- 每次部署都是一個新的 release 目錄，`current` symlink 以原子方式切換；預設保留最近 5 個版本，可隨時回滾。
- 服務以專用系統帳號（預設 `stockapp`，不能登入）執行，由 systemd 管理：開機自動啟動、當掉自動重啟。
- 部署後會自動做健康檢查（向 `http://127.0.0.1:<PORT>/config.js` 發請求，最多等 20 秒）；**新版本起不來會自動切回上一版**。

## 2. 需求

**伺服器**
- 使用 systemd 的 Linux 發行版（Ubuntu 20.04+、Debian 11+、RHEL/Rocky/Alma 8+ 等）。
- 已安裝 `curl`、`tar`、`sudo`（Ubuntu/Debian：`sudo apt install curl tar sudo`；RHEL 系：`sudo dnf install curl tar sudo`）。
- 一個可以用 SSH 金鑰登入、且有 `sudo` 權限的帳號（下稱「部署帳號」，例如 `deploy`）。只有第一次 setup 需要 sudo 密碼，之後部署不用。
- 能連到外網：安裝 Node（`n`，GitHub）、`npm ci`（npm registry），以及程式本身要連的 Yahoo Finance、NASDAQ Trader、SEC EDGAR、quantumonline。
- 能連到資料庫 `37.61.216.26:5432`（若資料庫有 IP 白名單，請 DBA 加入伺服器的 IP）。

**本機**
- `bash`、`git`、`ssh`（請在 WSL 執行；Git Bash 也可以）。
- 可以用 SSH 金鑰登入伺服器：`ssh deploy@<伺服器IP>` 不需輸入密碼。若還沒設定：
  ```bash
  ssh-copy-id deploy@<伺服器IP>
  ```

**Node 版本**：需要 >= 22.8.0。**絕對不能用 v22.7.0**（UTF-8 字元會亂碼，見 `db.js`）。若伺服器沒有合適的 Node，setup 會自動用 `n` 安裝 Node 22 到 `/usr/local/bin`。

## 3. 第一次部署

### 3.1 填寫部署設定

```bash
cp deploy/deploy.conf.example deploy/deploy.conf
```

編輯 `deploy/deploy.conf`（此檔已在 `.gitignore`，不會被 commit）：

| 設定 | 說明 | 預設 |
|---|---|---|
| `DEPLOY_HOST` | 伺服器 IP 或主機名 | （必填） |
| `DEPLOY_USER` | SSH 登入的部署帳號 | （必填） |
| `DEPLOY_SSH_PORT` | SSH 連接埠 | `22` |
| `DEPLOY_SSH_KEY` | 指定私鑰路徑（不填就用 ssh-agent / `~/.ssh` 預設） | 無 |
| `APP_DIR` | 伺服器上的安裝目錄 | `/opt/stock-app` |
| `APP_USER` | 執行服務的系統帳號 | `stockapp` |
| `SERVICE_NAME` | systemd 服務名稱 | `stock-app` |
| `NODE_VERSION` | 要安裝的 Node 主版本 | `22` |
| `APP_TZ` | 服務的時區；`.env` 的 `MONITOR_DAILY_AT` 以此時區計算 | `America/New_York` |
| `KEEP_RELEASES` | 伺服器上保留的版本數 | `5` |

### 3.2 準備伺服器用的 `.env`

**不要直接上傳本機的 `.env`**：其中的 `PUBLIC_URL` 是 WSL 的位址。建議複製一份另外修改：

```bash
cp .env server.env      # server.env 只放本機，不要 commit
```

修改 `server.env`：
- `PUBLIC_URL`：改成瀏覽器連到伺服器的網址，例如 `http://<伺服器IP>:3000`；或直接刪掉這行（前端改用相對路徑 `/api`，任何位址都能用，建議）。
- `PORT`、`HOST`：一般維持 `3000`、`0.0.0.0`。
- `MONITOR_DAILY_AT=03:00`：每天自動偵測並**寫入**資料庫。時間以紐約時間（`APP_TZ`）計算：紐約 03:00 等於台灣時間夏令期間 15:00、冬令期間 16:00。注意：如果本機（WSL）的伺服器也同時在跑並設定了這一行，兩邊會在同一時間對同一張表各跑一次 — 請只在其中一邊保留。
- 資料庫連線（`PG*`）、`SEC_EDGAR_CONTACT` 照舊。

### 3.3 執行 setup（一次性）

```bash
deploy/setup-server.sh --env-file server.env
```

過程中會要求輸入部署帳號在伺服器上的 **sudo 密碼**。它會：
1. 檢查 Node，必要時安裝 Node 22（>= 22.8.0）。
2. 建立系統帳號 `stockapp` 與 `/opt/stock-app/{releases,shared}`。
3. 把 `server.env` 安裝成 `/opt/stock-app/shared/.env`（權限 640，只有部署帳號與服務帳號可讀）。
4. 寫入 `/etc/systemd/system/stock-app.service` 並設為開機啟動。
5. 新增 `/etc/sudoers.d/stock-app-deploy`：允許部署帳號免密碼執行 `systemctl restart/status stock-app` 與 `journalctl -u stock-app`（僅限這幾個指令）。

setup 可以重複執行（例如修改 `deploy.conf` 之後）；不加 `--env-file` 時不會動到已有的 `.env`。

### 3.4 部署

```bash
deploy/deploy.sh
```

成功時最後會顯示 `Healthy: ... answered after Ns` 與 `Deployed <release>`。打開 `http://<伺服器IP>:3000` 確認。

### 3.5 防火牆

若伺服器有防火牆，需開放 3000 port（或改用反向代理，見第 7 節）：

```bash
sudo ufw allow 3000/tcp                                   # Ubuntu/Debian (ufw)
sudo firewall-cmd --permanent --add-port=3000/tcp && sudo firewall-cmd --reload   # RHEL 系 (firewalld)
```

雲端主機另外要在安全群組（security group）開放。

## 4. 日常更新

```bash
git commit ...           # 先 commit 要上線的修改
deploy/deploy.sh         # 部署 HEAD
deploy/deploy.sh v1.2    # 或部署指定的 tag / branch / commit
```

注意：重啟服務會中斷正在進行中的「股票偵測與自動更新」，以及新增股票後排定的自動補資料重試（這些狀態都只存在記憶體）。請避開偵測執行中（例如每天 03:00 之後約數分鐘）部署。

## 5. 回滾

```bash
deploy/rollback.sh --list               # 列出伺服器上的版本，* 為目前版本
deploy/rollback.sh                      # 切回上一個版本
deploy/rollback.sh 20261006153000-72b64bf   # 切到指定版本
```

回滾只切換程式碼；`shared/.env` 不受影響。

## 6. 維運

```bash
# 在伺服器上（部署帳號已有免密碼權限）
sudo systemctl status stock-app --no-pager
sudo journalctl -u stock-app -n 100 --no-pager     # 最近的 log
sudo journalctl -u stock-app -f                    # 即時追蹤 log

# 修改設定：編輯 shared/.env 後重啟
nano /opt/stock-app/shared/.env
sudo systemctl restart stock-app
```

在伺服器上執行 `scripts/` 的命令列工具（以服務帳號執行，才能讀 `.env`）：

```bash
cd /opt/stock-app/current
sudo -u stockapp node scripts/monitor-stocks.js AAPL MSFT          # 預覽
sudo -u stockapp node scripts/add-from-yahoo.js NVDA
```

（這需要部署帳號有一般 sudo 權限；會寫檔的腳本如 `export-to-csv.js` 請改用部署帳號執行，因為 release 目錄屬於部署帳號。）

## 7. 選用：用 Nginx 反向代理（80/443 port）

```nginx
server {
    listen 80;
    server_name stock.example.com;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 60s;   # 新增股票時伺服器最多等 20 秒查資料
    }
}
```

此時 `.env` 建議設 `HOST=127.0.0.1`（只讓 Nginx 連），並刪除 `PUBLIC_URL` 或設為 `http://stock.example.com`。HTTPS 可用 `certbot --nginx`。

## 8. 疑難排解

| 現象 | 原因 / 處理 |
|---|---|
| `Missing deploy/deploy.conf` | 依 3.1 建立設定檔。 |
| `Permission denied (publickey)` | 本機到伺服器的 SSH 金鑰沒設定好（`ssh-copy-id`）。 |
| `shared/.env missing` | setup 時沒給 `--env-file`；重跑 setup 加上它，或在伺服器上手動建立。 |
| `sudo: a password is required` | 沒跑 setup，或 `DEPLOY_USER`/`SERVICE_NAME` 改過後沒重跑 setup。 |
| `Health check failed` 並自動回滾 | 看隨後印出的 log。常見：資料庫連不上（IP 白名單）、`.env` 的 `PORT` 被佔用。 |
| 網頁打得開但資料載不出來 | `PUBLIC_URL` 還是舊位址 — 刪除或修正後重啟。 |
| 寫入時 `permission denied for schema sandbox` | 資料庫稽核觸發器的權限問題，需 DBA 授權，與部署無關。 |
| 公司名稱重音字元變 `�` | 伺服器 Node 是 v22.7.0 — 升級（`sudo n install 22`）後重啟。 |
| 每日偵測沒有執行 | `MONITOR_DAILY_AT` 未設定，或時間是依 `APP_TZ` 計算；確認 log 中的 `[monitor] daily check scheduled for ...`。 |

## 9. 移除

```bash
sudo systemctl disable --now stock-app
sudo rm /etc/systemd/system/stock-app.service /etc/sudoers.d/stock-app-deploy
sudo systemctl daemon-reload
sudo rm -rf /opt/stock-app
sudo userdel stockapp
```

資料都在遠端資料庫 `test.company_profiles`，移除伺服器不影響資料。
