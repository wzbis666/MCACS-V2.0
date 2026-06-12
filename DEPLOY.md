# Minecraft AntiCheat System — 部署指南

面向个人服务器管理者的完整部署文档。支持 **Docker 一键部署** 和 **Linux 脚本一键部署** 两种方式。

---

## 目录

- [系统架构](#系统架构)
- [环境要求](#环境要求)
- [方式一: Docker Compose 一键部署（推荐）](#方式一-docker-compose-一键部署推荐)
- [方式二: Linux 安装脚本](#方式二-linux-安装脚本)
- [方式三: 手动部署](#方式三-手动部署)
- [Minecraft 服务端配置](#minecraft-服务端配置)
- [部署验证](#部署验证)
- [配置说明](#配置说明)
- [常用运维命令](#常用运维命令)
- [常见问题](#常见问题)

---

## 系统架构

```
┌─────────────────┐     WebSocket     ┌──────────────────┐     HTTP      ┌──────────────┐
│  Minecraft 服务器 │ ◄──────────────► │  检测引擎 (Node.js) │ ◄───────────► │  前端监控面板  │
│  (Spigot 插件)   │    port 55211     │  处罚决策 + 数据存储 │   port 55210  │  (3D 可视化)  │
└─────────────────┘                    └──────────────────┘               └──────────────┘
```

---

## 环境要求

| 组件 | 最低版本 | 说明 |
|------|---------|------|
| 操作系统 | Ubuntu 20.04+ / Debian 11+ / CentOS 7+ | 64 位 |
| Node.js | 18+ | 检测引擎运行环境 |
| Java | 17+ | 编译 Spigot 插件 |
| Maven | 3.6+ | 构建 Spigot 插件 |
| Git | 2.0+ | 克隆项目 |
| Docker (可选) | 20.10+ | 容器化部署 |
| Minecraft 服务端 | Spigot/Paper 1.20.4 | 需要安装插件的服务器 |

**端口要求:**
- `55210` — 前端监控面板 + 管理 API
- `55211` — WebSocket（Spigot 插件与检测引擎通信）

---

## 方式一: Docker Compose 一键部署（推荐）

### 1. 克隆项目

```bash
git clone https://github.com/wzbis666/MCACS-V2.0.git
cd minecraft-anticheat
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，设置 ACS_AUTH_SECRET（推荐）
nano .env
```

### 3. 一键启动

```bash
# 基础部署（仅检测引擎 + 前端面板）
docker compose up -d

# 完整部署（含 Nginx 反向代理，推荐生产环境）
docker compose --profile full up -d
```

### 4. 构建 Spigot 插件

```bash
# 在宿主机上构建插件（需要 Java 17 + Maven）
cd spigot-plugin && mvn clean package -q
# 插件位于: spigot-plugin/target/minecraft-anticheat-0.1.0.jar
```

### 5. 验证运行

```bash
docker compose ps
docker compose logs -f anticheat-engine
```

---

## 方式二: Linux 安装脚本

支持 Ubuntu、Debian、CentOS 的自动化安装。

### 1. 下载并运行脚本

```bash
# 克隆项目
git clone https://github.com/wzbis666/MCACS-V2.0.git
cd minecraft-anticheat

# 以 root 权限运行
sudo bash install.sh
```

脚本会自动完成以下操作:
1. 检测操作系统类型
2. 安装 Node.js 18+、Java 17+、Maven、Git
3. 安装项目依赖并构建前端
4. 构建 Spigot 插件 JAR
5. 创建 systemd 服务（开机自启）
6. 配置防火墙规则
7. 启动服务并验证

### 2. 手动指定仓库地址

```bash
REPO_URL=https://github.com/wzbis666/MCACS-V2.0.git sudo -E bash install.sh
```

---

## 方式三: 手动部署

### 1. 安装依赖

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install -y git nodejs npm openjdk-17-jdk-headless maven
```

**CentOS/RHEL:**
```bash
sudo yum install -y git nodejs npm java-17-openjdk-headless maven
```

### 2. 克隆并安装项目

```bash
git clone https://github.com/wzbis666/MCACS-V2.0.git /opt/minecraft-anticheat
cd /opt/minecraft-anticheat

# 安装后端依赖
npm install

# 构建前端
cd town-frontend
npm install
npx vite build --outDir dist
cd ..
```

### 3. 构建 Spigot 插件

```bash
cd spigot-plugin
mvn clean package -q
# 插件输出: target/minecraft-anticheat-0.1.0.jar
cd ..
```

### 4. 创建 systemd 服务

```bash
sudo tee /etc/systemd/system/minecraft-anticheat.service << 'EOF'
[Unit]
Description=Minecraft AntiCheat Monitoring System
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/minecraft-anticheat
ExecStart=/opt/minecraft-anticheat/node_modules/.bin/tsx src/plugin/index.ts
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=TZ=Asia/Shanghai

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now minecraft-anticheat
```

### 5. 配置防火墙

```bash
# UFW
sudo ufw allow 55210/tcp
sudo ufw allow 55211/tcp

# 或 Firewalld
sudo firewall-cmd --permanent --add-port=55210/tcp
sudo firewall-cmd --permanent --add-port=55211/tcp
sudo firewall-cmd --reload
```

---

## Minecraft 服务端配置

### 1. 安装插件

将构建好的 JAR 文件复制到 Minecraft 服务器的 `plugins/` 目录:

```bash
cp spigot-plugin/target/minecraft-anticheat-0.1.0.jar /path/to/minecraft/plugins/
```

### 2. 配置插件连接地址

插件首次启动后会在 `plugins/AntiCheatMonitor/` 目录生成配置文件。编辑 `config.yml`:

```yaml
# WebSocket 连接地址（指向检测引擎）
websocket:
  host: "localhost"        # 如果检测引擎和MC服务器在同一台机器上
  port: 55211
  # 如果检测引擎在其他服务器上，改为对应 IP
  # host: "192.168.1.100"
  token: ""                # 如果设置了 ACS_AUTH_SECRET，填写相同值
```

### 3. 重启 Minecraft 服务器

```bash
# 在 Minecraft 服务器控制台执行
reload confirm
# 或重启整个服务器
```

---

## 部署验证

### 1. 检查服务状态

```bash
# Docker 方式
docker compose ps

# 或 systemd 方式
systemctl status minecraft-anticheat
```

### 2. 检查端口监听

```bash
ss -tlnp | grep -E "55210|55211"
```

预期输出应显示两个端口都在监听。

### 3. 访问监控面板

浏览器打开 `http://<服务器IP>:55210`，应看到 3D 城镇监控界面。

### 4. 检查 WebSocket 连接

在 Minecraft 服务器控制台执行:

```
anticheat status
```

应显示 WebSocket 连接状态为 `CONNECTED`。

### 5. 查看日志

```bash
# Docker
docker compose logs -f anticheat-engine

# systemd
journalctl -u minecraft-anticheat -f
```

正常日志应包含:
```
[WsServer] Listening on ws://localhost:55211
[Main] Minecraft Anti-Cheat system started
[WsServer] Spigot connected
```

---

## 配置说明

### 处罚策略配置

编辑 `penalty-config.yml` 可自定义处罚策略，支持热重载（修改后自动生效，无需重启）:

```yaml
penalty:
  enabled: true              # 总开关
  vp:
    weights:
      low: 1                 # 低置信度 VP 增量
      medium: 3              # 中置信度 VP 增量
      high: 8                # 高置信度 VP 增量
    type_multipliers:        # 各作弊类型 VP 倍率
      kill_aura: 1.5
      fly: 1.2
      speed: 1.2
  thresholds:
    L0_warn: 5               # 警告阈值
    L1_kick: 15              # 踢出阈值
    L2_ban_1h: 30            # 1小时封禁
    L3_ban_24h: 60           # 24小时封禁
    L4_ban_7d: 100           # 7天封禁
    L5_ban_permanent: 150    # 永久封禁
```

### 安全密钥

设置 `ACS_AUTH_SECRET` 后，所有 WebSocket 连接需要携带此 token:

```bash
echo "ACS_AUTH_SECRET=$(openssl rand -hex 32)" >> .env
```

然后在 Spigot 插件配置中填写相同的 token。

---

## 常用运维命令

| 操作 | 命令 |
|------|------|
| 启动服务 | `sudo systemctl start minecraft-anticheat` |
| 停止服务 | `sudo systemctl stop minecraft-anticheat` |
| 重启服务 | `sudo systemctl restart minecraft-anticheat` |
| 查看状态 | `sudo systemctl status minecraft-anticheat` |
| 实时日志 | `sudo journalctl -u minecraft-anticheat -f` |
| 开机自启 | `sudo systemctl enable minecraft-anticheat` |
| Docker 启动 | `docker compose up -d` |
| Docker 停止 | `docker compose down` |
| Docker 日志 | `docker compose logs -f` |
| 更新项目 | `cd /opt/minecraft-anticheat && git pull && npm install` |
| 重建插件 | `cd spigot-plugin && mvn clean package -q` |

---

## 常见问题

### Q: 监控面板显示"未连接"

**原因:** 检测引擎未启动或端口被防火墙阻止。

**解决:**
```bash
# 检查服务状态
sudo systemctl status minecraft-anticheat
# 检查端口
ss -tlnp | grep 55210
# 检查防火墙
sudo ufw status
```

### Q: Spigot 插件连接失败

**原因:** 检测引擎地址配置错误或网络不通。

**解决:**
1. 检查 `plugins/AntiCheatMonitor/config.yml` 中的 `host` 和 `port`
2. 确保检测引擎的 55211 端口可被 Minecraft 服务器访问
3. 如果设置了 `ACS_AUTH_SECRET`，确保插件配置中填写了相同的 token

### Q: 服务启动后立即退出

**解决:**
```bash
# 查看详细日志
sudo journalctl -u minecraft-anticheat -n 100 --no-pager
# 常见原因: 端口被占用、Node.js 版本过低、依赖未安装
```

### Q: 端口被占用

**解决:**
```bash
# 查看占用端口的进程
sudo ss -tlnp | grep 55211
# 修改端口（编辑 src/plugin/ws-server.ts 中的 PORT 常量）
```

### Q: 如何更新到最新版本

```bash
cd /opt/minecraft-anticheat
git pull
npm install
cd town-frontend && npm install && npx vite build --outDir dist && cd ..
cd spigot-plugin && mvn clean package -q && cd ..
sudo systemctl restart minecraft-anticheat
# 将新的 JAR 复制到 Minecraft 服务器 plugins/ 目录
```

### Q: 数据存储在哪里

所有数据存储在 `/opt/minecraft-anticheat/data/` 目录:
- `cheat-records.jsonl` — 作弊检测记录
- `bans.jsonl` — 封禁/解封记录
- `whitelist.jsonl` — 白名单记录
- `vp-snapshot.json` — VP 积分快照

### Q: 如何备份数据

```bash
# 备份整个数据目录
tar -czf anticheat-backup-$(date +%Y%m%d).tar.gz /opt/minecraft-anticheat/data/
# 备份配置文件
cp penalty-config.yml penalty-config.yml.bak
```