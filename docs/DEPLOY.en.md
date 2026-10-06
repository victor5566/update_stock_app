# Deployment Guide: Stock Symbol Manager on a Remote Linux Server

This guide explains how to deploy the site to a remote Linux server with the scripts in `deploy/`. The app runs there as a systemd service.

## 1. Overview

```
Local machine (WSL / Linux / macOS)        Remote Linux server
-----------------------------------        -----------------------------------------
deploy/setup-server.sh  --ssh-->  one-time: installs Node, creates the user, dirs and systemd service
deploy/deploy.sh        --ssh-->  /opt/stock-app/releases/<time>-<commit>/  (new release)
                                  /opt/stock-app/current -> live release (symlink)
                                  /opt/stock-app/shared/.env  (the server's own settings)
deploy/rollback.sh      --ssh-->  points current back at an older release
```

- Code is uploaded with `git archive`, so **only committed code is deployed**. Uncommitted changes stay on your machine.
- Each deploy creates a new release directory, and the `current` symlink switches over in one atomic step. The newest 5 releases are kept, so you can roll back at any time.
- The service runs as a dedicated system user (`stockapp` by default, no login shell). systemd manages it: the service starts on boot and restarts if it crashes.
- After each deploy, a health check requests `http://127.0.0.1:<PORT>/config.js` and waits up to 20 seconds for an answer. **If the new release doesn't come up, the previous release is restored automatically.**

## 2. Requirements

**Server**
- A Linux distribution that uses systemd (Ubuntu 20.04+, Debian 11+, RHEL/Rocky/Alma 8+, etc.).
- `curl`, `tar` and `sudo` installed (Ubuntu/Debian: `sudo apt install curl tar sudo`; RHEL family: `sudo dnf install curl tar sudo`).
- An account you can SSH into with a key and that has `sudo` rights (the "deploy user", e.g. `deploy`). Only the first-time setup asks for the sudo password. Later deploys don't need it.
- Outbound internet access for:
  - installing Node (`n`, from GitHub)
  - `npm ci` (the npm registry)
  - the services the app calls: Yahoo Finance, NASDAQ Trader, SEC EDGAR and quantumonline.
- Access to the database at `37.61.216.26:5432`. If the database restricts which IP addresses can connect, ask the DBA to allow the server's IP.

**Local machine**
- `bash`, `git` and `ssh` (run the scripts from WSL; Git Bash also works).
- Key-based SSH login to the server: `ssh deploy@<server-ip>` must work without a password. To set it up:
  ```bash
  ssh-copy-id deploy@<server-ip>
  ```

**Node version**: the app needs Node 22.8.0 or newer. **Never use v22.7.0**: it garbles UTF-8 text (see `db.js`). If the server has no suitable Node, setup installs Node 22 into `/usr/local/bin` with `n`.

## 3. First deployment

### 3.1 Fill in the deploy settings

```bash
cp deploy/deploy.conf.example deploy/deploy.conf
```

Edit `deploy/deploy.conf`. It is gitignored, so it is never committed.

| Setting | Meaning | Default |
|---|---|---|
| `DEPLOY_HOST` | Server IP address or hostname | (required) |
| `DEPLOY_USER` | Deploy user for SSH login | (required) |
| `DEPLOY_SSH_PORT` | SSH port | `22` |
| `DEPLOY_SSH_KEY` | Path to a private key (if unset, the ssh-agent or `~/.ssh` defaults are used) | none |
| `APP_DIR` | Install directory on the server | `/opt/stock-app` |
| `APP_USER` | System user the service runs as | `stockapp` |
| `SERVICE_NAME` | systemd service name | `stock-app` |
| `NODE_VERSION` | Node major version to install | `22` |
| `APP_TZ` | The service's time zone. `MONITOR_DAILY_AT` in `.env` uses this zone. | `Asia/Taipei` |
| `KEEP_RELEASES` | Number of releases kept on the server | `5` |

### 3.2 Prepare the server's `.env`

**Don't upload your local `.env` as it is.** Its `PUBLIC_URL` is the WSL address. Make a copy and edit the copy:

```bash
cp .env server.env      # keep server.env on your machine; don't commit it
```

Edit `server.env`:
- `PUBLIC_URL`: set it to the address browsers use to reach the server, e.g. `http://<server-ip>:3000`. Or delete the line (recommended): the frontend then uses the relative path `/api`, which works from any address.
- `PORT`, `HOST`: normally leave these at `3000` and `0.0.0.0`.
- `MONITOR_DAILY_AT=03:00`: runs the stock check every day and **writes the results to the database**. If your local (WSL) server is also running with this line, both servers will run the check on the same table at the same time. Keep the line on only one of them.
- Keep the database settings (`PG*`) and `SEC_EDGAR_CONTACT` as they are.

### 3.3 Run setup (once)

```bash
deploy/setup-server.sh --env-file server.env
```

You'll be asked for the deploy user's **sudo password** on the server. The script then:
1. Checks Node and installs Node 22 (>= 22.8.0) if needed.
2. Creates the system user `stockapp` and the directories `/opt/stock-app/{releases,shared}`.
3. Installs `server.env` as `/opt/stock-app/shared/.env` (mode 640: only the deploy user and the service user can read it).
4. Writes `/etc/systemd/system/stock-app.service` and enables it, so it starts on boot.
5. Adds `/etc/sudoers.d/stock-app-deploy`. This lets the deploy user run `systemctl restart/status stock-app` and `journalctl -u stock-app` without a password. No other commands are allowed by this rule.

Setup is safe to re-run, e.g. after you change `deploy.conf`. Without `--env-file`, it leaves an existing `.env` untouched.

### 3.4 Deploy

```bash
deploy/deploy.sh
```

A successful deploy ends with `Healthy: ... answered after Ns` and `Deployed <release>`. Open `http://<server-ip>:3000` to check the site.

### 3.5 Firewall

If the server runs a firewall, open port 3000 (or use a reverse proxy instead, see section 7):

```bash
sudo ufw allow 3000/tcp                                   # Ubuntu/Debian (ufw)
sudo firewall-cmd --permanent --add-port=3000/tcp && sudo firewall-cmd --reload   # RHEL family (firewalld)
```

On a cloud host, also open the port in its security group.

## 4. Routine updates

```bash
git commit ...           # commit the changes you want to release
deploy/deploy.sh         # deploy HEAD
deploy/deploy.sh v1.2    # or deploy a specific tag / branch / commit
```

A deploy restarts the service. The restart stops a stock check that is still running and drops the auto-fill retries scheduled after recent adds, because both exist only in memory. Don't deploy while a check is running, e.g. in the minutes after 03:00.

## 5. Rollback

```bash
deploy/rollback.sh --list               # list releases on the server (* = current)
deploy/rollback.sh                      # go back to the previous release
deploy/rollback.sh 20261006153000-72b64bf   # switch to a specific release
```

A rollback only switches the code. `shared/.env` is not changed.

## 6. Operations

```bash
# On the server (the deploy user needs no password for these)
sudo systemctl status stock-app --no-pager
sudo journalctl -u stock-app -n 100 --no-pager     # recent log
sudo journalctl -u stock-app -f                    # follow the log

# To change settings: edit shared/.env, then restart
nano /opt/stock-app/shared/.env
sudo systemctl restart stock-app
```

To run the `scripts/` CLI tools on the server, run them as the service user so they can read `.env`:

```bash
cd /opt/stock-app/current
sudo -u stockapp node scripts/monitor-stocks.js AAPL MSFT          # preview
sudo -u stockapp node scripts/add-from-yahoo.js NVDA
```

This needs general sudo rights for the deploy user. Scripts that write files, such as `export-to-csv.js`, must run as the deploy user instead, because the deploy user owns the release directories.

## 7. Optional: Nginx reverse proxy (ports 80/443)

```nginx
server {
    listen 80;
    server_name stock.example.com;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 60s;   # adding a stock can take up to 20s of lookups
    }
}
```

With a proxy in front:
- Set `HOST=127.0.0.1` in `.env` so that only Nginx can connect to the app.
- Delete `PUBLIC_URL`, or set it to `http://stock.example.com`.
- For HTTPS, use `certbot --nginx`.

## 8. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Missing deploy/deploy.conf` | Create it as in 3.1. |
| `Permission denied (publickey)` | SSH key login to the server isn't set up (`ssh-copy-id`). |
| `shared/.env missing` | Setup ran without `--env-file`. Re-run setup with it, or create the file on the server. |
| `sudo: a password is required` | Setup hasn't run yet, or `DEPLOY_USER`/`SERVICE_NAME` changed and setup wasn't re-run. |
| `Health check failed`, then an automatic rollback | Read the log printed after the message. Common causes: the server can't reach the database (IP restriction), or another process is using the `PORT` from `.env`. |
| The page loads but shows no data | `PUBLIC_URL` still points at an old address. Fix or delete it, then restart. |
| Writes fail with `permission denied for schema sandbox` | A permission on the database's audit trigger. The DBA must grant it; it isn't a deployment problem. |
| Accented company names show as `�` | The server's Node is v22.7.0. Upgrade it (`sudo n install 22`) and restart. |
| The daily check doesn't run | `MONITOR_DAILY_AT` isn't set, or you expected a different time zone (it uses `APP_TZ`). Look for `[monitor] daily check scheduled for ...` in the log. |

## 9. Uninstall

```bash
sudo systemctl disable --now stock-app
sudo rm /etc/systemd/system/stock-app.service /etc/sudoers.d/stock-app-deploy
sudo systemctl daemon-reload
sudo rm -rf /opt/stock-app
sudo userdel stockapp
```

All data lives in the remote database table `test.company_profiles`, so removing the server doesn't affect it.
