package com.anticheat.listener;

import com.anticheat.AntiCheatPlugin;
import com.anticheat.executor.ActionExecutor;
import com.anticheat.ws.MessageProtocol;
import org.bukkit.Bukkit;
import org.bukkit.OfflinePlayer;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.GameMode;
import org.bukkit.event.player.AsyncPlayerPreLoginEvent;
import org.bukkit.event.player.PlayerDropItemEvent;
import org.bukkit.event.player.PlayerGameModeChangeEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerKickEvent;
import org.bukkit.event.player.PlayerToggleFlightEvent;
import org.bukkit.event.player.PlayerToggleSneakEvent;

import java.util.UUID;

public class PlayerListener implements Listener {

    private final AntiCheatPlugin plugin;
    private final ActionExecutor executor;

    public PlayerListener(AntiCheatPlugin plugin) {
        this.plugin = plugin;
        this.executor = plugin.getActionExecutor();
    }

    @EventHandler(priority = EventPriority.LOWEST)
    public void onPreLogin(AsyncPlayerPreLoginEvent event) {
        UUID uuid = event.getUniqueId();
        String name = event.getName();

        // 1. 检查 UUID 封禁（通过 OfflinePlayer.isBanned()）
        @SuppressWarnings("deprecation")
        OfflinePlayer offline = Bukkit.getOfflinePlayer(uuid);
        boolean uuidBanned = offline.isBanned();

        // 2. 检查 NAME 封禁
        org.bukkit.BanEntry nameBan = Bukkit.getBanList(org.bukkit.BanList.Type.NAME).getBanEntry(name);
        boolean nameBanned = (nameBan != null);

        // 3. 如果任一侧被封禁，检查是否过期
        if (uuidBanned || nameBanned) {
            // 获取 NAME 封禁的过期时间（用于判断）
            java.util.Date nameExpiry = nameBanned ? nameBan.getExpiration() : null;

            // NAME 封禁已过期 → 双重解封
            if (nameBanned && nameExpiry != null && nameExpiry.before(new java.util.Date())) {
                Bukkit.getBanList(org.bukkit.BanList.Type.NAME).pardon(name);
                if (uuidBanned) {
                    offline.ban(null, (java.util.Date) null, null);
                }
                return;
            }

            // UUID 封禁但 NAME 未封禁 → 同步 NAME 封禁
            if (uuidBanned && !nameBanned) {
                Bukkit.getBanList(org.bukkit.BanList.Type.NAME).addBan(name, "Anti-Cheat Ban", null, "AntiCheat");
            }
            // NAME 封禁但 UUID 未封禁 → 同步 UUID 封禁
            if (!uuidBanned && nameBanned) {
                offline.ban(nameBan.getReason(), nameBan.getExpiration(), nameBan.getSource());
            }

            // 拒绝登录
            String reason = (nameBan != null && nameBan.getReason() != null) ? nameBan.getReason() : "你已被服务器封禁";
            event.disallow(AsyncPlayerPreLoginEvent.Result.KICK_BANNED, reason);
        }
    }

    /** 比较两个 BanEntry，返回过期时间更晚的那个 */
    private org.bukkit.BanEntry getLaterExpiry(org.bukkit.BanEntry a, org.bukkit.BanEntry b) {
        if (a == null) return b;
        if (b == null) return a;
        java.util.Date aExpiry = a.getExpiration();
        java.util.Date bExpiry = b.getExpiration();
        if (aExpiry == null) return a; // null = permanent, always later
        if (bExpiry == null) return b;
        return aExpiry.after(bExpiry) ? a : b;
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onPlayerJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();
        String message = MessageProtocol.playerJoin(
                player.getUniqueId(),
                player.getName(),
                player.getAddress() != null ? player.getAddress().getAddress().getHostAddress() : "unknown",
                player.getGameMode().name()
        );
        plugin.getWebSocketClient().send(message);
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onPlayerQuit(PlayerQuitEvent event) {
        Player player = event.getPlayer();

        // Determine exit type: cheat_ban if player is banned or was kicked by anti-cheat
        String exitType = "normal";
        if (player.isBanned()) {
            exitType = "cheat_ban";
        }

        String message = MessageProtocol.playerLeave(
                player.getUniqueId(),
                "DISCONNECT",
                exitType
        );
        plugin.getWebSocketClient().send(message);

        plugin.getMovementTracker().removePlayer(player.getUniqueId());
        plugin.getCombatTracker().removePlayer(player.getUniqueId());
        plugin.getBlockTracker().removePlayer(player.getUniqueId());
        plugin.getActionExecutor().removePlayer(player.getUniqueId());
        // 清理 MovementListener 中的状态追踪
        if (plugin.getMovementListener() != null) {
            plugin.getMovementListener().removePlayer(player.getUniqueId());
        }
    }

    /**
     * When a player is kicked from the server (by anti-cheat or admin),
     * mark the exit as cheat_ban so the frontend keeps the NPC visible.
     */
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onPlayerKick(PlayerKickEvent event) {
        Player player = event.getPlayer();
        String reason = event.getReason() != null ? event.getReason() : "KICKED";

        // Kicks from anti-cheat or admin bans are always cheat_ban
        String exitType = "cheat_ban";

        String message = MessageProtocol.playerLeave(
                player.getUniqueId(),
                reason,
                exitType
        );
        plugin.getWebSocketClient().send(message);

        plugin.getMovementTracker().removePlayer(player.getUniqueId());
        plugin.getCombatTracker().removePlayer(player.getUniqueId());
        plugin.getBlockTracker().removePlayer(player.getUniqueId());
        plugin.getActionExecutor().removePlayer(player.getUniqueId());
        // 清理 MovementListener 中的状态追踪
        if (plugin.getMovementListener() != null) {
            plugin.getMovementListener().removePlayer(player.getUniqueId());
        }
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onGameModeChange(PlayerGameModeChangeEvent event) {
        Player player = event.getPlayer();
        String message = MessageProtocol.gameModeChange(
                player.getUniqueId(),
                player.getGameMode().name(),
                event.getNewGameMode().name()
        );
        plugin.getWebSocketClient().send(message);
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onToggleFlight(PlayerToggleFlightEvent event) {
        Player player = event.getPlayer();
        String message = MessageProtocol.playerAction(
                player.getUniqueId(),
                "flight",
                event.isFlying()
        );
        plugin.getWebSocketClient().send(message);
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onToggleSneak(PlayerToggleSneakEvent event) {
        Player player = event.getPlayer();
        String message = MessageProtocol.playerAction(
                player.getUniqueId(),
                "sneak",
                event.isSneaking()
        );
        plugin.getWebSocketClient().send(message);
    }

    // ── 冻结状态下的操作拦截 ──

    /** 冻结状态下禁止右键交互（打开容器、使用物品等） */
    @EventHandler(priority = EventPriority.LOWEST)
    public void onPlayerInteract(PlayerInteractEvent event) {
        if (executor.isFrozen(event.getPlayer().getUniqueId())) {
            event.setCancelled(true);
        }
    }

    /** 冻结状态下禁止丢弃物品 */
    @EventHandler(priority = EventPriority.LOWEST)
    public void onPlayerDropItem(PlayerDropItemEvent event) {
        if (executor.isFrozen(event.getPlayer().getUniqueId())) {
            event.setCancelled(true);
        }
    }
}
