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
            sendResult(actionId, false, "Missing action or uuid");
            return;
        }

        UUID uuid;
        try {
            uuid = UUID.fromString(uuidStr);
        } catch (IllegalArgumentException e) {
            sendResult(actionId, false, "Invalid UUID: " + uuidStr);
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
                case MessageProtocol.ACTION_VP_UPDATE:
                    success = sendVPUpdate(uuid, MessageProtocol.getDouble(message, "totalVP"));
                    resultMsg = success ? "VP update sent" : "Player not found";
                    break;
                default:
                    success = false;
                    resultMsg = "Unknown action: " + action;
                    break;
            }
            sendResult(actionId, success, resultMsg);
        });
    }

    private boolean kickPlayer(UUID uuid, String reason) {
        Player player = Bukkit.getPlayer(uuid);
        if (player == null) return false;
        player.kickPlayer(reason != null ? reason : "Kicked by AntiCheat");
        return true;
    }

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
            player.kickPlayer(banReason);
        }
        // 通知 Node.js 封禁已执行
        plugin.getWebSocketClient().send(
            MessageProtocol.banExecuted(uuid, playerName, banReason, durationStr, "anticheat")
        );
        return true;
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

    private void sendResult(String actionId, boolean success, String message) {
        if (actionId != null && wsClient != null) {
            wsClient.send(MessageProtocol.actionExecuted(actionId, success, message));
        }
    }

    public void removePlayer(UUID uuid) {
        frozenPlayers.remove(uuid);
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
    }
}
