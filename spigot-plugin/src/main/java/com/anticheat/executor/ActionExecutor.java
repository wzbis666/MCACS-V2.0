package com.anticheat.executor;

import java.util.Date;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.bukkit.BanList;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.json.simple.JSONObject;
import com.anticheat.AntiCheatPlugin;
import com.anticheat.ws.MessageProtocol;
import com.anticheat.ws.WebSocketClient;
import net.md_5.bungee.api.ChatMessageType;
import net.md_5.bungee.api.chat.TextComponent;

public class ActionExecutor {

    private final AntiCheatPlugin plugin;
    private WebSocketClient wsClient;
    private final Map<UUID, Long> frozenPlayers = new ConcurrentHashMap<>();
    // 封禁冻结：记录封禁信息（reason + duration），用于持续显示封禁提示
    private final Map<UUID, BanFreezeInfo> banFreezeInfoMap = new ConcurrentHashMap<>();

    /** 封禁冻结信息 */
    public static class BanFreezeInfo {
        public final String reason;
        public final long durationMs; // 0 = 永久
        public final long freezeStartTime;

        public BanFreezeInfo(String reason, long durationMs) {
            this.reason = reason;
            this.durationMs = durationMs;
            this.freezeStartTime = System.currentTimeMillis();
        }

        /** 获取剩余时间描述 */
        public String getRemainingTime() {
            if (durationMs <= 0) return "永久";
            long remaining = durationMs - (System.currentTimeMillis() - freezeStartTime);
            if (remaining <= 0) return "已到期";
            long seconds = remaining / 1000;
            if (seconds < 60) return seconds + "秒";
            long minutes = seconds / 60;
            if (minutes < 60) return minutes + "分" + (seconds % 60) + "秒";
            long hours = minutes / 60;
            if (hours < 24) return hours + "时" + (minutes % 60) + "分";
            long days = hours / 24;
            return days + "天" + (hours % 24) + "时";
        }
    }

    public ActionExecutor(AntiCheatPlugin plugin, WebSocketClient wsClient) {
        this.plugin = plugin;
        this.wsClient = wsClient;
    }

    public void setWsClient(WebSocketClient wsClient) {
        this.wsClient = wsClient;
    }

    public void executeAction(JSONObject message) {
        String actionRaw = MessageProtocol.getString(message, "type");
        if (actionRaw == null) {
            actionRaw = MessageProtocol.getString(message, "action");
        }
        final String action = actionRaw;
        String actionId = MessageProtocol.getString(message, "actionId");
        // Node.js sends 'playerId', Spigot historically expects 'uuid' — check both
        String uuidRaw = MessageProtocol.getString(message, "playerId");
        if (uuidRaw == null) {
            uuidRaw = MessageProtocol.getString(message, "uuid");
        }
        final String uuidStr = uuidRaw;

        if (action == null || uuidStr == null) {
            sendResult(actionId, null, action, false, "Missing action or uuid");
            return;
        }

        UUID uuid;
        try {
            uuid = UUID.fromString(uuidStr);
        } catch (IllegalArgumentException e) {
            sendResult(actionId, null, action, false, "Invalid UUID: " + uuidStr);
            return;
        }

        Bukkit.getScheduler().runTask(plugin, () -> {
            boolean success;
            String resultMsg;
            switch (action) {
                case MessageProtocol.ACTION_KICK:
                    success = kickPlayer(uuid, MessageProtocol.getString(message, "reason"));
                    resultMsg = success ? "Player kicked" : "Player not found";
                    break;
                case MessageProtocol.ACTION_BAN:
                    success = banPlayer(uuid,
                            MessageProtocol.getString(message, "reason"),
                            parseDuration(message));
                    resultMsg = success ? "Player banned" : "Ban failed";
                    break;
                case MessageProtocol.ACTION_UNBAN:
                    success = unbanPlayer(uuid);
                    resultMsg = success ? "Player unbanned" : "Unban failed";
                    break;
                case MessageProtocol.ACTION_WHITELIST_ADD:
                    success = whitelistAdd(uuid);
                    resultMsg = success ? "Added to whitelist" : "Whitelist add failed";
                    break;
                case MessageProtocol.ACTION_WHITELIST_REMOVE:
                    success = whitelistRemove(uuid);
                    resultMsg = success ? "Removed from whitelist" : "Whitelist remove failed";
                    break;
                case MessageProtocol.ACTION_TELEPORT:
                    success = teleportPlayer(uuid,
                            MessageProtocol.getDouble(message, "x"),
                            MessageProtocol.getDouble(message, "y"),
                            MessageProtocol.getDouble(message, "z"));
                    resultMsg = success ? "Player teleported" : "Player not found";
                    break;
                case MessageProtocol.ACTION_FREEZE:
                    success = freezePlayer(uuid, parseDuration(message));
                    resultMsg = success ? "Player frozen" : "Player not found";
                    break;
                case MessageProtocol.ACTION_WARNING:
                    success = sendWarning(uuid, MessageProtocol.getString(message, "reason"));
                    resultMsg = success ? "Warning sent" : "Player not found";
                    break;
                case MessageProtocol.ACTION_PERSISTENT_WARNING:
                    success = sendPersistentWarning(uuid,
                            MessageProtocol.getString(message, "reason"),
                            MessageProtocol.getString(message, "cheatType"),
                            MessageProtocol.getString(message, "confidence"));
                    resultMsg = success ? "Persistent warning sent" : "Player not found";
                    break;
                case MessageProtocol.ACTION_VP_UPDATE:
                    success = sendVPUpdate(uuid, MessageProtocol.getDouble(message, "totalVP"));
                    resultMsg = success ? "VP update sent" : "Player not found";
                    break;
                default:
                    success = false;
                    resultMsg = "Unknown action: " + action;
                    break;
            }
            sendResult(actionId, uuid, action, success, resultMsg);
        });
    }

    private boolean kickPlayer(UUID uuid, String reason) {
        Player player = Bukkit.getPlayer(uuid);
        if (player == null) return false;
        player.kickPlayer(reason != null ? reason : "Kicked by AntiCheat");
        return true;
    }

    /** 封禁前冻结展示时间（毫秒）：封禁后先冻结展示5秒，再踢出 */
    private static final long BAN_FREEZE_DISPLAY_MS = 5000;

    private boolean banPlayer(UUID uuid, String reason, long durationMs) {
        Player player = Bukkit.getPlayer(uuid);
        String playerName = player != null ? player.getName() : uuid.toString();
        Date expiry = durationMs > 0 ? new Date(System.currentTimeMillis() + durationMs) : null;
        String banReason = reason != null ? reason : "Banned by AntiCheat";
        String durationStr = durationMs > 0 ? String.valueOf(durationMs) : "permanent";

        // 使用 OfflinePlayer.ban() 封禁（基于 UUID，防止改用户名绕过）
        @SuppressWarnings("deprecation")
        org.bukkit.OfflinePlayer offline = Bukkit.getOfflinePlayer(uuid);
        offline.ban(banReason, expiry, "AntiCheat");

        // 同时封禁 NAME 列表（兼容旧版查询）
        Bukkit.getBanList(BanList.Type.NAME).addBan(playerName, banReason, expiry, "AntiCheat");

        if (player != null) {
            // ── 冻结玩家：固定位置、禁止一切操作 ──
            long freezeExpiry = System.currentTimeMillis() + BAN_FREEZE_DISPLAY_MS;
            frozenPlayers.put(uuid, freezeExpiry);
            banFreezeInfoMap.put(uuid, new BanFreezeInfo(banReason, durationMs));

            // 显示封禁 Title 提示
            String durationDisplay = durationMs > 0 ? formatDurationDisplay(durationMs) : "永久";
            try {
                player.sendTitle(
                    "§c§l你已被封禁",
                    "§e原因: " + banReason + " | 时长: " + durationDisplay,
                    5, 100, 20
                );
            } catch (NoClassDefFoundError ignored) {}

            // 启动 ActionBar 定时刷新封禁信息（每秒更新剩余时间）
            startBanActionBarTask(uuid);

            // 延迟踢出：先冻结展示，再踢出
            Bukkit.getScheduler().runTaskLater(plugin, () -> {
                banFreezeInfoMap.remove(uuid);
                // 取消 ActionBar 任务在 removePlayer 中处理
                Player p = Bukkit.getPlayer(uuid);
                if (p != null) {
                    p.kickPlayer("§c你已被封禁\n§e原因: " + banReason + "\n§e时长: " + durationDisplay);
                }
            }, BAN_FREEZE_DISPLAY_MS / 50); // 转换为 ticks
        }

        // 通知 Node.js 封禁已执行
        plugin.getWebSocketClient().send(
            MessageProtocol.banExecuted(uuid, playerName, banReason, durationStr, "anticheat")
        );
        return true;
    }

    /** 格式化封禁时长为可读文本 */
    private String formatDurationDisplay(long durationMs) {
        long seconds = durationMs / 1000;
        if (seconds < 60) return seconds + "秒";
        long minutes = seconds / 60;
        if (minutes < 60) return minutes + "分钟";
        long hours = minutes / 60;
        if (hours < 24) return hours + "小时";
        long days = hours / 24;
        return days + "天";
    }

    /** 封禁冻结期间的 ActionBar 定时任务 ID */
    private final Map<UUID, Integer> banActionBarTaskIds = new ConcurrentHashMap<>();

    /** 启动 ActionBar 定时刷新，每秒更新封禁信息 */
    private void startBanActionBarTask(UUID uuid) {
        // 取消已有的任务
        Integer existingTask = banActionBarTaskIds.remove(uuid);
        if (existingTask != null) {
            Bukkit.getScheduler().cancelTask(existingTask);
        }

        // 每20 ticks（1秒）刷新一次 ActionBar
        int taskId = Bukkit.getScheduler().runTaskTimerAsynchronously(plugin, () -> {
            Player player = Bukkit.getPlayer(uuid);
            BanFreezeInfo info = banFreezeInfoMap.get(uuid);
            if (player == null || info == null) {
                // 玩家已离线或封禁信息已清除，取消任务
                Integer tid = banActionBarTaskIds.remove(uuid);
                if (tid != null) Bukkit.getScheduler().cancelTask(tid);
                return;
            }
            String actionBarText = "§c§l[封禁中] §e原因: " + info.reason + " §7| §e剩余: " + info.getRemainingTime();
            try {
                player.spigot().sendMessage(ChatMessageType.ACTION_BAR, TextComponent.fromLegacyText(actionBarText));
            } catch (NoClassDefFoundError e) {
                player.sendMessage(actionBarText);
            }
        }, 0L, 20L).getTaskId();

        banActionBarTaskIds.put(uuid, taskId);
    }

    private boolean unbanPlayer(UUID uuid) {
        Player player = Bukkit.getPlayer(uuid);
        String playerName = player != null ? player.getName() : null;
        if (playerName == null) {
            @SuppressWarnings("deprecation")
            org.bukkit.OfflinePlayer offline = Bukkit.getOfflinePlayer(uuid);
            if (offline.getName() != null) {
                playerName = offline.getName();
            }
        }

        // 使用 OfflinePlayer 解封（基于 UUID 的 ProfileBanList）
        @SuppressWarnings("deprecation")
        org.bukkit.OfflinePlayer offline = Bukkit.getOfflinePlayer(uuid);
        offline.ban(null, (Date) null, null); // 清除封禁

        // 同时解除 NAME 封禁
        if (playerName != null) {
            Bukkit.getBanList(BanList.Type.NAME).pardon(playerName);
        }

        // 通知 Node.js 解封已执行
        plugin.getWebSocketClient().send(
            MessageProtocol.unbanExecuted(uuid, playerName != null ? playerName : uuid.toString(), "anticheat")
        );
        return true;
    }

    private boolean whitelistAdd(UUID uuid) {
        @SuppressWarnings("deprecation")
        org.bukkit.OfflinePlayer offline = Bukkit.getOfflinePlayer(uuid);
        offline.setWhitelisted(true);
        return true;
    }

    private boolean whitelistRemove(UUID uuid) {
        @SuppressWarnings("deprecation")
        org.bukkit.OfflinePlayer offline = Bukkit.getOfflinePlayer(uuid);
        offline.setWhitelisted(false);
        return true;
    }

    private boolean teleportPlayer(UUID uuid, double x, double y, double z) {
        Player player = Bukkit.getPlayer(uuid);
        if (player == null) return false;
        Location loc = new Location(player.getWorld(), x, y, z);
        player.teleport(loc);
        return true;
    }

    private boolean freezePlayer(UUID uuid, long durationMs) {
        Player player = Bukkit.getPlayer(uuid);
        if (player == null) return false;
        long expiry = durationMs > 0 ? System.currentTimeMillis() + durationMs : Long.MAX_VALUE;
        frozenPlayers.put(uuid, expiry);
        if (durationMs > 0) {
            Bukkit.getScheduler().runTaskLaterAsynchronously(
                    plugin,
                    () -> frozenPlayers.remove(uuid),
                    durationMs / 50
            );
        }
        return true;
    }

    public boolean isFrozen(UUID uuid) {
        Long expiry = frozenPlayers.get(uuid);
        if (expiry == null) return false;
        if (System.currentTimeMillis() > expiry) {
            frozenPlayers.remove(uuid);
            return false;
        }
        return true;
    }

    public void unfreezePlayer(UUID uuid) {
        frozenPlayers.remove(uuid);
    }

    private boolean sendWarning(UUID uuid, String reason) {
        Player player = Bukkit.getPlayer(uuid);
        if (player == null) return false;

        String warningText = reason != null ? reason : "§c[AntiCheat] 检测到异常行为，请停止违规操作";

        // 1. ActionBar 警告（屏幕上方持续显示）
        try {
            player.spigot().sendMessage(ChatMessageType.ACTION_BAR, TextComponent.fromLegacyText(warningText));
        } catch (NoClassDefFoundError e) {
            player.sendMessage("§c" + warningText);
        }

        // 2. 聊天栏详细警告
        player.sendMessage("§6§l[AntiCheat] §e" + (reason != null ? reason : "警告：检测到异常行为"));

        // 3. Title 大字警告（屏幕中央醒目显示，3秒）
        try {
            player.sendTitle("§c§l⚠ 警告", "§e" + (reason != null ? reason : "检测到异常行为"), 10, 60, 20);
        } catch (NoClassDefFoundError e) {
            // Fallback for older Spigot versions without Title API
        }
        return true;
    }

    // ── 持续警告（首次作弊检测时使用，ActionBar 持续显示，无法关闭） ──
    private static final long PERSISTENT_WARNING_DURATION_MS = 30_000; // 持续30秒
    private final Map<UUID, Integer> persistentWarningTaskIds = new ConcurrentHashMap<>();

    /** 作弊类型中文标签映射 */
    private static String getCheatTypeLabel(String cheatType) {
        if (cheatType == null) return "未知作弊";
        switch (cheatType.toLowerCase()) {
            case "fly": return "飞行作弊";
            case "speed": return "速度作弊";
            case "kill_aura": return "自瞄作弊";
            case "x_ray": return "透视作弊";
            case "scaffold": return "搭桥作弊";
            case "auto_clicker": return "自动点击";
            case "reach": return "距离作弊";
            default: return cheatType + "作弊";
        }
    }

    private boolean sendPersistentWarning(UUID uuid, String reason, String cheatType, String confidence) {
        Player player = Bukkit.getPlayer(uuid);
        if (player == null) return false;

        // 取消已有的持续警告任务
        cancelPersistentWarning(uuid);

        String cheatLabel = getCheatTypeLabel(cheatType);
        String confLabel = confidence != null ? confidence : "medium";
        String timestamp = new java.text.SimpleDateFormat("HH:mm:ss").format(new Date());

        // 1. Title 大字警告（屏幕中央，红色边框醒目设计，持续6秒）
        try {
            player.sendTitle(
                "§4§l⚠ 作弊警告 ⚠",
                "§c" + cheatLabel + " §7| §e" + timestamp + " §7| §f再次检测将封禁",
                5, 120, 20  // fadeIn=5ticks, stay=120ticks(6s), fadeOut=20ticks
            );
        } catch (NoClassDefFoundError ignored) {}

        // 2. 聊天栏详细警告（红色边框设计）
        player.sendMessage("§c§l╔══════════════════════════════════════╗");
        player.sendMessage("§c§l║  §e§l⚠ [AntiCheat] 作弊行为检测警告  §c§l║");
        player.sendMessage("§c§l╠══════════════════════════════════════╣");
        player.sendMessage("§c§l║  §f作弊类型: §c" + cheatLabel);
        player.sendMessage("§c§l║  §f检测时间: §e" + timestamp);
        player.sendMessage("§c§l║  §f置信度: §e" + confLabel);
        player.sendMessage("§c§l║  §f详情: §7" + (reason != null ? reason : "检测到异常行为"));
        player.sendMessage("§c§l╠══════════════════════════════════════╣");
        player.sendMessage("§c§l║  §4§l⚠ 再次检测将直接踢出并封禁！请立即停止！ §c§l║");
        player.sendMessage("§c§l╚══════════════════════════════════════╝");

        // 3. ActionBar 持续刷新警告（每秒更新，持续30秒）
        int taskId = Bukkit.getScheduler().runTaskTimerAsynchronously(plugin, () -> {
            Player p = Bukkit.getPlayer(uuid);
            if (p == null) {
                cancelPersistentWarning(uuid);
                return;
            }
            try {
                p.spigot().sendMessage(ChatMessageType.ACTION_BAR,
                    TextComponent.fromLegacyText("§4§l⚠ [警告] §c" + cheatLabel + " §7| §e再次检测将封禁！"));
            } catch (NoClassDefFoundError e) {
                // fallback: 不重复发送聊天消息
            }
        }, 0L, 20L).getTaskId();

        persistentWarningTaskIds.put(uuid, taskId);

        // 30秒后自动停止持续警告
        Bukkit.getScheduler().runTaskLaterAsynchronously(plugin, () -> {
            cancelPersistentWarning(uuid);
        }, PERSISTENT_WARNING_DURATION_MS / 50);

        return true;
    }

    /** 取消持续警告任务 */
    private void cancelPersistentWarning(UUID uuid) {
        Integer taskId = persistentWarningTaskIds.remove(uuid);
        if (taskId != null) {
            Bukkit.getScheduler().cancelTask(taskId);
        }
    }

    private boolean sendVPUpdate(UUID uuid, double totalVP) {
        Player player = Bukkit.getPlayer(uuid);
        if (player == null) return false;

        // 在 ActionBar 显示当前 VP 积分
        String vpText = String.format("§6[AntiCheat] §e违规积分: %.1f", totalVP);
        try {
            player.spigot().sendMessage(ChatMessageType.ACTION_BAR, TextComponent.fromLegacyText(vpText));
        } catch (NoClassDefFoundError e) {
            player.sendMessage(vpText);
        }
        return true;
    }

    private void sendResult(String actionId, UUID uuid, String action, boolean success, String message) {
        if (actionId != null && wsClient != null) {
            wsClient.send(MessageProtocol.actionExecuted(actionId, uuid, action, success, message));
        }
    }

    public void removePlayer(UUID uuid) {
        frozenPlayers.remove(uuid);
        banFreezeInfoMap.remove(uuid);
        Integer taskId = banActionBarTaskIds.remove(uuid);
        if (taskId != null) {
            Bukkit.getScheduler().cancelTask(taskId);
        }
        cancelPersistentWarning(uuid);
    }

    /**
     * Parse duration from message — supports both numeric (ms) and string formats ("1h", "7d", "permanent").
     */
    private long parseDuration(JSONObject message) {
        // Try numeric first (milliseconds)
        long ms = MessageProtocol.getLong(message, "duration");
        if (ms > 0) return ms;

        // Try string format
        String durStr = MessageProtocol.getString(message, "duration");
        if (durStr == null || durStr.isEmpty() || "permanent".equalsIgnoreCase(durStr)) return 0;

        durStr = durStr.trim().toLowerCase();
        try {
            long value = Long.parseLong(durStr.replaceAll("[^0-9]", ""));
            if (durStr.endsWith("d")) return value * 24 * 60 * 60 * 1000L;
            if (durStr.endsWith("h")) return value * 60 * 60 * 1000L;
            if (durStr.endsWith("m")) return value * 60 * 1000L;
            if (durStr.endsWith("s")) return value * 1000L;
            return value; // bare number = ms
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    public void clear() {
        frozenPlayers.clear();
        banFreezeInfoMap.clear();
        for (Integer taskId : banActionBarTaskIds.values()) {
            Bukkit.getScheduler().cancelTask(taskId);
        }
        banActionBarTaskIds.clear();
        for (Integer taskId : persistentWarningTaskIds.values()) {
            Bukkit.getScheduler().cancelTask(taskId);
        }
        persistentWarningTaskIds.clear();
    }
}
