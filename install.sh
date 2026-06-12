#!/usr/bin/env bash
# ============================================================
# Minecraft AntiCheat System — 一键部署脚本
# 支持: Ubuntu 20.04+/22.04/24.04, Debian 11/12, CentOS 7/8/9
# 用法: bash install.sh
# ============================================================

set -euo pipefail

# ── 颜色输出 ──
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'
BOLD='\033[1m'

log_info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }
log_step()  { echo -e "\n${CYAN}${BOLD}==>${NC} ${BOLD}$*${NC}"; }
banner() {
    echo -e "${BLUE}"
    echo "  ╔══════════════════════════════════════════════╗"
    echo "  ║     Minecraft AntiCheat System v0.1.0        ║"
    echo "  ║         一键部署脚本 for Linux               ║"
    echo "  ╚══════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# ── 检测系统 ──
detect_os() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$ID
        OS_VERSION=$VERSION_ID
    elif [ -f /etc/redhat-release ]; then
        OS="centos"
        OS_VERSION=$(rpm -q --qf "%{VERSION}" $(rpm -q --whatprovides redhat-release) 2>/dev/null || echo "7")
    else
        log_error "无法检测操作系统类型"
        exit 1
    fi
    log_info "检测到系统: ${OS} ${OS_VERSION}"
}

# ── 检查是否为 root ──
check_root() {
    if [ "$(id -u)" -ne 0 ]; then
        log_error "请使用 root 用户运行此脚本: sudo bash install.sh"
        exit 1
    fi
}

# ── 安装 Node.js 18+ ──
install_nodejs() {
    if command -v node &>/dev/null; then
        NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
        if [ "$NODE_VER" -ge 18 ]; then
            log_info "Node.js $(node -v) 已安装，跳过"
            return
        fi
    fi

    log_step "安装 Node.js 18+"
    case "$OS" in
        ubuntu|debian)
            curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
            apt-get install -y nodejs
            ;;
        centos|rhel|fedora)
            curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
            yum install -y nodejs
            ;;
        *)
            log_error "不支持的系统: $OS"
            exit 1
            ;;
    esac
    log_info "Node.js $(node -v) 安装完成"
}

# ── 安装 Java 17+ ──
install_java() {
    if command -v java &>/dev/null; then
        JAVA_VER=$(java -version 2>&1 | head -1 | cut -d'"' -f2 | cut -d. -f1)
        if [ "$JAVA_VER" -ge 17 ]; then
            log_info "Java $(java -version 2>&1 | head -1) 已安装，跳过"
            return
        fi
    fi

    log_step "安装 Java 17+"
    case "$OS" in
        ubuntu|debian)
            apt-get update -qq
            apt-get install -y openjdk-17-jdk-headless
            ;;
        centos|rhel|fedora)
            yum install -y java-17-openjdk-headless
            ;;
    esac
    log_info "Java 安装完成"
}

# ── 安装 Maven ──
install_maven() {
    if command -v mvn &>/dev/null; then
        log_info "Maven $(mvn --version 2>/dev/null | head -1) 已安装，跳过"
        return
    fi

    log_step "安装 Maven"
    case "$OS" in
        ubuntu|debian)
            apt-get install -y maven
            ;;
        centos|rhel|fedora)
            yum install -y maven
            ;;
    esac
    log_info "Maven 安装完成"
}

# ── 安装 Git ──
install_git() {
    if command -v git &>/dev/null; then
        log_info "Git 已安装，跳过"
        return
    fi
    log_step "安装 Git"
    case "$OS" in
        ubuntu|debian) apt-get install -y git ;;
        centos|rhel|fedora) yum install -y git ;;
    esac
}

# ── 克隆项目 ──
clone_repo() {
    INSTALL_DIR="/opt/minecraft-anticheat"
    REPO_URL="${REPO_URL:-https://github.com/wzbis666/MCACS-V2.0.git}"

    if [ -d "$INSTALL_DIR/.git" ]; then
        log_info "项目已存在，执行 git pull 更新..."
        cd "$INSTALL_DIR"
        git pull origin main 2>/dev/null || git pull origin master 2>/dev/null || true
        return
    fi

    log_step "克隆项目到 $INSTALL_DIR"
    if [ -d "$INSTALL_DIR" ]; then
        log_warn "目录已存在但非 git 仓库，备份后重新克隆..."
        mv "$INSTALL_DIR" "${INSTALL_DIR}.bak.$(date +%s)"
    fi

    git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
}

# ── 安装 Node.js 依赖并构建前端 ──
setup_node() {
    log_step "安装 Node.js 依赖"
    cd "$INSTALL_DIR"
    npm install

    log_step "构建前端"
    cd "$INSTALL_DIR/town-frontend"
    npm install
    npx vite build --outDir dist
    log_info "前端构建完成 → town-frontend/dist/"
}

# ── 构建 Spigot 插件 ──
build_plugin() {
    log_step "构建 Spigot 插件"
    cd "$INSTALL_DIR/spigot-plugin"
    mvn clean package -q
    PLUGIN_JAR=$(ls target/minecraft-anticheat-*.jar 2>/dev/null | head -1)
    if [ -z "$PLUGIN_JAR" ]; then
        log_error "Spigot 插件构建失败，请检查 Java/Maven 配置"
        exit 1
    fi
    log_info "插件构建完成: $PLUGIN_JAR"
    echo ""
    echo -e "  ${YELLOW}${BOLD}请将以下文件复制到 Minecraft 服务器的 plugins/ 目录:${NC}"
    echo -e "  ${CYAN}cp $PLUGIN_JAR /path/to/minecraft/plugins/${NC}"
}

# ── 创建 systemd 服务 ──
create_service() {
    log_step "创建 systemd 服务"

    cat > /etc/systemd/system/minecraft-anticheat.service << 'SERVICE_EOF'
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
Environment=ACS_AUTH_SECRET=
Environment=TZ=Asia/Shanghai

# 安全加固
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/opt/minecraft-anticheat/data
ReadOnlyPaths=/opt/minecraft-anticheat/penalty-config.yml

[Install]
WantedBy=multi-user.target
SERVICE_EOF

    systemctl daemon-reload
    systemctl enable minecraft-anticheat
    log_info "systemd 服务已创建并设置为开机自启"
}

# ── 配置防火墙 ──
configure_firewall() {
    log_step "配置防火墙"
    if command -v ufw &>/dev/null && ufw status | grep -q "active"; then
        ufw allow 55211/tcp comment "AntiCheat WebSocket"
        ufw allow 55210/tcp comment "AntiCheat Admin Panel"
        log_info "UFW 规则已添加"
    elif command -v firewall-cmd &>/dev/null && systemctl is-active --quiet firewalld 2>/dev/null; then
        firewall-cmd --permanent --add-port=55211/tcp
        firewall-cmd --permanent --add-port=55210/tcp
        firewall-cmd --reload
        log_info "Firewalld 规则已添加"
    else
        log_warn "未检测到防火墙，请手动开放端口 55210 和 55211"
    fi
}

# ── 配置 .env ──
setup_env() {
    if [ ! -f "$INSTALL_DIR/.env" ]; then
        cat > "$INSTALL_DIR/.env" << 'ENV_EOF'
# Minecraft AntiCheat 环境配置
# 生成安全密钥: openssl rand -hex 32
ACS_AUTH_SECRET=
TZ=Asia/Shanghai
ENV_EOF
        log_info ".env 配置文件已创建，请编辑设置 ACS_AUTH_SECRET"
    fi
}

# ── 启动服务 ──
start_service() {
    log_step "启动服务"
    systemctl start minecraft-anticheat
    sleep 3
    if systemctl is-active --quiet minecraft-anticheat; then
        log_info "服务启动成功!"
    else
        log_error "服务启动失败，请检查日志: journalctl -u minecraft-anticheat -n 50"
        exit 1
    fi
}

# ── 部署验证 ──
verify_deployment() {
    log_step "部署验证"

    echo ""
    echo "  ┌─────────────────────────────────────────────────┐"
    echo "  │           部署验证结果                          │"
    echo "  ├─────────────────────────────────────────────────┤"

    # Node.js
    if command -v node &>/dev/null; then
        echo -e "  │  Node.js     ${GREEN}✓${NC}  $(node -v)"
    else
        echo -e "  │  Node.js     ${RED}✗${NC}  未安装"
    fi

    # Java
    if command -v java &>/dev/null; then
        echo -e "  │  Java        ${GREEN}✓${NC}  $(java -version 2>&1 | head -1)"
    else
        echo -e "  │  Java        ${RED}✗${NC}  未安装"
    fi

    # 服务状态
    if systemctl is-active --quiet minecraft-anticheat 2>/dev/null; then
        echo -e "  │  检测引擎    ${GREEN}✓${NC}  运行中"
    else
        echo -e "  │  检测引擎    ${RED}✗${NC}  未运行"
    fi

    # 端口监听
    if ss -tlnp 2>/dev/null | grep -q ":55211 "; then
        echo -e "  │  WS 端口     ${GREEN}✓${NC}  55211 已监听"
    else
        echo -e "  │  WS 端口     ${YELLOW}⚠${NC}  55211 未监听"
    fi

    if ss -tlnp 2>/dev/null | grep -q ":55210 "; then
        echo -e "  │  API 端口    ${GREEN}✓${NC}  55210 已监听"
    else
        echo -e "  │  API 端口    ${YELLOW}⚠${NC}  55210 未监听"
    fi

    echo "  └─────────────────────────────────────────────────┘"
    echo ""
}

# ── 输出完成信息 ──
print_summary() {
    SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "YOUR_SERVER_IP")

    echo ""
    echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}${BOLD}║           🎉 部署完成！                          ║${NC}"
    echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  ${BOLD}监控面板:${NC}    http://${SERVER_IP}:55210"
    echo -e "  ${BOLD}WebSocket:${NC}   ws://${SERVER_IP}:55211"
    echo ""
    echo -e "  ${BOLD}后续步骤:${NC}"
    echo "  1. 将 Spigot 插件 JAR 复制到 Minecraft 服务器"
    echo "     cp spigot-plugin/target/minecraft-anticheat-*.jar /path/to/minecraft/plugins/"
    echo ""
    echo "  2. 重启 Minecraft 服务器"
    echo ""
    echo "  3. 设置安全密钥（可选但推荐）"
    echo "     echo 'ACS_AUTH_SECRET=$(openssl rand -hex 32)' >> /opt/minecraft-anticheat/.env"
    echo "     systemctl restart minecraft-anticheat"
    echo ""
    echo -e "  ${BOLD}常用命令:${NC}"
    echo "    systemctl status minecraft-anticheat   # 查看状态"
    echo "    systemctl restart minecraft-anticheat  # 重启服务"
    echo "    journalctl -u minecraft-anticheat -f   # 实时日志"
    echo ""
}

# ── 主流程 ──
main() {
    banner
    check_root
    detect_os

    log_step "安装系统依赖"
    case "$OS" in
        ubuntu|debian) apt-get update -qq ;;
        centos|rhel|fedora) yum makecache -q ;;
    esac

    install_git
    install_nodejs
    install_java
    install_maven

    clone_repo
    setup_node
    build_plugin
    setup_env
    create_service
    configure_firewall
    start_service
    verify_deployment
    print_summary
}

main "$@"