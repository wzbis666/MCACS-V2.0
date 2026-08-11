# 本地服务器运行说明

## 启动顺序

1. 运行 `C:\Users\WZB\Desktop\spigot\start-control.bat`，启动案件、处罚、申诉与可视化后台。
2. 运行 `C:\Users\WZB\Desktop\spigot\start.bat`，启动 Spigot 1.20.1 服务器。
3. 打开 `http://127.0.0.1:55210` 访问本机管理后台。

两个窗口都需要保持运行。先关闭 Minecraft 服务器，再关闭控制层。

## 玩家登录

- 首次进入：`/register <密码> <再次输入密码>`，密码至少 8 位。
- 后续进入：`/login <密码>`。
- 当前使用兼容 Spigot 1.20.1 / Java 17 的 AuthMe 5.7，因此离线玩家和正版玩家都需要登录密码。正版免登录可在以后升级服务端核心时接入，不影响本轮本地验证。

## 当前处罚策略

- 所有作弊类型共享一次记录。
- 30 分钟内第一次命中：警告并建立或更新案件。
- 30 分钟内第二次命中：冻结展示 5 秒，随后踢出并封禁 1 小时。
- Grim 高可信命中：直接执行同样的 1 小时临时封禁。
- Grim 不直接执行处罚；它只负责检测，MCACS 负责证据、案件、处罚和申诉。
- 申诉批准：解封、清除警告和 VP、关闭该玩家未结案件，历史记录保留。

## 已安装插件

- GrimAC 2.3.73
- PacketEvents 2.13.0
- AuthMe Reloaded 5.7.0
- AntiCheatMonitor 0.1.0（本项目桥接插件）

安装前备份位于 `C:\Users\WZB\Desktop\spigot\backups\pre-grim-20260811-2248`。
