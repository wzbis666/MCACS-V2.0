# MCACS V2.0 — Minecraft Anti-Cheat Suite

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org/)
[![Java](https://img.shields.io/badge/Java-17%2B-orange)](https://adoptium.net/)
[![Minecraft](https://img.shields.io/badge/Minecraft-1.20.4-brightgreen)](https://www.spigotmc.org/)
[![Docker](https://img.shields.io/badge/Docker-supported-2496ED)](https://www.docker.com/)

[MCACS 3D监控面板概览](docs/images/overview.png)

---

## 项目简介

MCACS V2.0 是一套从零自研的 Minecraft 服务端反作弊系统，专为**个人服务器管理者**及**中小型游戏社区**设计。它不仅仅是「查外挂的工具」——而是一个集行为分析、自动决策、3D 可视化于一体的综合安全运营平台。

### 核心功能

| 模块 | 能力 |
|------|------|
| **实时行为检测** | 覆盖 Fly、Speed、KillAura、Reach、Scaffold、AutoClicker、X-Ray 共 7 类核心作弊 |
| **VP 积分模型** | 独创的累进式违规积分体系，按置信度和作弊类型加权累加，避免单次误判导致误封 |
| **渐进式处罚** | L0 警告 → L1 踢出 → L2 1小时封禁 → L3 24小时 → L4 7天 → L5 永久，复合累犯加重机制 |
| **3D 可视化面板** | Three.js 驱动的虚拟城镇，将玩家行为实时映射为 NPC 的位置、状态与动作，让管理员一目了然 |
| **IP 关联反规避** | 多账号共享 IP 时自动提升 VP 累加速度，有效防御小号换号续作行为 |
| **行为基线建模** | 持续统计玩家正常操作分布，在处罚前验证基线成熟度，从系统层面控制误报率 |
| **玩家申诉通道** | 内置申诉流程与管理员审核系统，兼顾反作弊强度与玩家体验 |
| **热重载策略** | 处罚阈值、VP 权重等所有参数均支持运行中热更新，无需重启服务 |

<!-- 核心功能示意图占位
![MCACS 核心功能概述](docs/images/features.png)
-->

### 目标用户

- 运营 Minecraft 个人服务器的服主
- 希望零运维成本部署反作弊方案的社区管理员
- 对检测逻辑透明性有要求的开发型用户（全源码开放，可自行审计和定制）

---

## 技术亮点

MCACS 的反作弊引擎完全自研，未依赖任何第三方反作弊库。以下深入介绍其核心技术设计。

### 1. VP 积分模型 —— 从「单点判断」到「行为累积」

传统反作弊方案大多基于单一维度的阈值判断（如「速度超过 X 即踢出」），这种方式容易在延迟波动或服务端卡顿下造成误判。

MCACS 采用 **Violation Points (VP)** 累积模型：

```
VP 增量 = 基础VP × 作弊类型权重 × 置信度系数 × 白名单倍率 × IP关联倍率 × 新玩家宽限倍率
```

- **基础 VP**：由置信度决定（low=1, medium=3, high=8）
- **作弊类型权重**：KillAura ×1.5（危害最高）→ AutoClicker ×0.8（危害较低）
- **白名单机制**：白名单玩家的 VP 增量自动减半（`÷2.0`）
- **IP 关联**：多账号共享 IP 时，VP 按 `1.0 + N × 0.7` 的倍率累加
- **新玩家保护**：加入 5 分钟内的玩家 VP 增量 `×0.5`，防止新手误伤

这一设计确保了：**单次异常不会立刻触发封禁，但持续的作弊行为会以指数级速度逼近处罚阈值**。

### 2. 处罚前验证机制 —— 双重保险

VP 达到处罚阈值并不意味着立刻执行。MCACS 引入了 **Verification Gate**：

```
处罚触发 → 基线成熟度检查 → 风暴检测 → 执行/降级
```

- **基线成熟度检查**：要求玩家至少有 30 条以上行为样本，否则处罚自动降级为警告
- **风暴检测**：当短时间内同一作弊类型产生大量检测时，暂停自动处罚并通知管理员人工介入

### 3. 行为基线建模

MCACS 持续为每个玩家建立**正常行为分布曲线**：

- 移动速度的均值与标准差
- CPS（每秒点击次数）的分布区间
- 命中率与角度的相关性

当检测引擎标记出异常时，系统会比对当前数据偏离基线的程度。偏离在正常波动范围内的事件会被降权处理，减少因网络延迟或操作习惯导致的误报。

### 4. 架构优势

```
┌─ 数据采集层 (Java) ───────────────────────────────────────────┐
│  Spigot Plugin │ 独立线程采集 · 毫秒级采样 · 无阻塞游戏主线程    │
│  4 个轻量 Listener · 3 个 Tracker · 事件即发即走                │
└────────────────────────┬──────────────────────────────────────┘
                         │ WebSocket (MsgPack + 自动重连)
┌────────────────────────▼──────────────────────────────────────┐
│  分析决策层 (TypeScript) │ 热重载 · 配置驱动 · 无状态可水平扩展  │
│  检测引擎 → VP管理 → 处罚决策 → 动作分发 + ACK/NACK 可靠性      │
└────────────────────────┬──────────────────────────────────────┘
                         │ WebSocket 广播
┌────────────────────────▼──────────────────────────────────────┐
│  可视化层 (Vite + Three.js)                                    │
│  3D 城镇 · NPC 实时映射 · 告警面板 · 一键操作 · 音乐系统        │
└───────────────────────────────────────────────────────────────┘
```

关键设计决策：

| 设计点 | 选择 | 理由 |
|--------|------|------|
| 语言分离 | 采集层 Java / 分析层 TypeScript | 各司其职，TypeScript 更适合复杂逻辑模型迭代 |
| 通信协议 | WebSocket + ACK/NACK | 保证处罚指令不会在网络异常时丢失 |
| 配置策略 | YAML + 文件监听 | 修改即生效，无需接触代码 |
| 数据存储 | JSONL 追加写 | 不可变审计日志，可追溯所有操作 |
| 前端框架 | Vite + Three.js | 极快的构建速度，原生 3D 渲染能力 |

### 5. 性能与安全

- **插件性能**：所有数据采集在独立线程中完成，不阻塞 Minecraft 游戏主线程（Server Tick）
- **网络开销**：单玩家移动事件约 60 bytes，100 人在线时带宽消耗约 120 KB/s
- **安全认证**：支持共享密钥认证（`ACS_AUTH_SECRET`），防止未授权连接注入指令
- **审计追踪**：所有检测、处罚、申诉均写入 JSONL 日志，不可篡改

<!-- 架构示意图占位
![MCACS 系统架构](docs/images/architecture.png)
-->

---

## 产品定位 —— 为什么不是又一个「后台面板」

市面上大多数反作弊方案呈现出两种极端：要么是纯控制台命令驱动的轮子（对非技术用户不友好），要么是庞大商业套件（资源开销大、需要独立数据库、学习成本高）。

MCACS 选择了一条不同的路线：

### 与传统后台管理系统的区别

| 维度 | 传统方案 | MCACS |
|------|---------|-------|
| **管理员体验** | 控制台命令行 / 简陋 Web 表格 | **3D 虚拟城镇**，玩家行为可视化 |
| **部署复杂度** | 手动配置 / 多步骤安装 | Docker 一行命令启动，或 `sudo bash install.sh` |
| **资源依赖** | MySQL/Redis 数据库 | 仅需 Node.js + Java，数据以 JSONL 文件存储 |
| **检测透明度** | 闭源黑盒 | 全源码开放，可审计、可定制 |
| **误封风险** | 单点阈值判断，误封率较高 | VP 累积 + 基线验证 + 风暴检测，三层防护 |
| **运营友好度** | 需要理解反作弊概念 | 3D 可视化 + 一键操作，所见即所得 |

### 核心理念

> **「反作弊系统不应该只服务开发者，更应该服务服主和玩家。」**

MCACS 的 3D 面板不是为了炫技——它让管理员在**不阅读任何日志**的情况下直观看到：
- 哪个区域的玩家正在被检测（NPC 红色高亮）
- 哪个玩家需要人工介入（NPC 从房屋中被带出到拘留区）
- 服务器整体作弊态势（面板统计数字）

<!-- 产品对比示意图占位
![MCACS 3D监控面板 vs 传统面板](docs/images/comparison.png)
-->

---

## 快速开始

### Docker 部署（推荐，30 秒启动）

```bash
git clone https://github.com/wzbis666/MCACS-V2.0.git
cd MCACS-V2.0

# 配置环境变量（可选但推荐）
cp .env.example .env

# 启动
docker compose up -d
```

访问 `http://<服务器IP>:55210` 打开监控面板。

### Linux 一键脚本

```bash
git clone https://github.com/wzbis666/MCACS-V2.0.git
cd MCACS-V2.0
sudo bash install.sh
```

脚本自动完成：系统检测 → 安装 Node.js/Java/Maven → 构建前后端 → 创建 systemd 服务 → 配置防火墙。

### 安装 Spigot 插件

```bash
cd spigot-plugin && mvn clean package -q
# 将 target/minecraft-anticheat-*.jar 复制到 Minecraft 服务器的 plugins/ 目录
```

### 详细文档

完整的部署指南、配置说明和故障排查请参阅 [DEPLOY.md](DEPLOY.md)。

---

## 项目结构

```
MCACS-V2.0/
├── src/                         # 分析决策层 (TypeScript)
│   ├── plugin/                  # 核心引擎
│   │   ├── index.ts             #   主入口 · 组件编排
│   │   ├── rule-engine.ts       #   检测规则引擎 (7 种作弊)
│   │   ├── penalty-engine.ts    #   处罚决策引擎 (VP → 等级 → 动作)
│   │   ├── vp-manager.ts        #   VP 积分管理 (累加 · 衰减 · 持久化)
│   │   ├── ip-tracker.ts        #   IP 关联追踪 (反小号)
│   │   ├── baseline-tracker.ts  #   行为基线建模
│   │   ├── verification.ts      #   处罚前验证门控
│   │   ├── action-dispatcher.ts #   动作分发 (ACK/NACK · 重试)
│   │   ├── appeal-manager.ts    #   玩家申诉管理
│   │   └── ws-server.ts         #   WebSocket 服务
│   ├── bridge/                  # 前端桥接 (事件翻译 · 状态管理)
│   └── contracts/               # 类型契约
├── town-frontend/               # 可视化层 (Vite + Three.js)
│   └── src/
│       ├── game/                # 主场景 · 相机 · 特效
│       ├── ui/                  # UI 面板 (告警 · 封禁 · 统计 · 申诉)
│       ├── npc/                 # NPC 系统 (模型 · 漫游 · 管理)
│       └── scene/               # 3D 场景 (建筑 · 车辆 · 装饰)
├── spigot-plugin/               # 数据采集层 (Java · Maven)
│   └── src/main/java/com/anticheat/
│       ├── listener/            # 事件监听 (移动 · 战斗 · 方块 · 进出)
│       ├── tracker/             # 数据采集器 (位置 · 攻击 · 破坏)
│       ├── ws/                  # WebSocket 客户端 (自动重连)
│       └── executor/            # 处罚执行 (kick · ban · freeze · tp)
├── docker-compose.yml           # Docker 编排
├── install.sh                   # Linux 一键部署脚本
├── penalty-config.yml           # 处罚策略配置 (热重载)
└── DEPLOY.md                    # 详细部署文档
```

---

## 配置

### 处罚策略

编辑 `penalty-config.yml` 自定义阈值与权重，修改后自动热重载：

```yaml
penalty:
  enabled: true
  thresholds:
    L0_warn: 5           # 警告
    L1_kick: 15          # 踢出
    L2_ban_1h: 30        # 封禁 1 小时
    L3_ban_24h: 60       # 封禁 24 小时
    L4_ban_7d: 100       # 封禁 7 天
    L5_ban_permanent: 150 # 永久封禁
  vp:
    weights:
      low: 1
      medium: 3
      high: 8
    type_multipliers:
      kill_aura: 1.5
      fly: 1.2
      speed: 1.2
      reach: 1.3
```

### 安全密钥

```bash
# 生成密钥
openssl rand -hex 32

# 写入配置
echo "ACS_AUTH_SECRET=你的密钥" >> .env

# 重启生效
docker compose restart
```

设置后，所有 WebSocket 连接均需携带此 token，防止未授权的指令注入。

---

## 环境要求

| 组件 | 最低版本 | 用途 |
|------|---------|------|
| Node.js | 18+ | 检测引擎运行环境 |
| Java | 17+ (OpenJDK) | 编译 Spigot 插件 |
| Maven | 3.6+ | Spigot 插件构建 |
| Minecraft | Spigot / Paper 1.20.4 | 目标服务端 |
| Docker | 20.10+ (可选) | 容器化部署 |

---

## 鸣谢

本项目在创意与交互设计上深受 [agentshire 项目](https://github.com/Agentshire/Agentshire) 的启发。agentshire 开创性地将「Agent + 3D 城镇」的交互范式引入游戏管理系统，MCACS 在此思路上延伸出面向反作弊场景的专业化应用。在此对 agentshire 的原作者表达诚挚感谢。

---

## 贡献

欢迎提交 Issue 和 Pull Request。参与前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

本项目采用 [MIT License](LICENSE)。

## 免责声明

本工具仅供 Minecraft 服务器管理员用于维护游戏公平性。使用者应遵守当地法律法规及 Minecraft EULA。