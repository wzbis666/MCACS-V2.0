package com.anticheat.listener;

import java.util.Map;
import java.util.UUID;
import com.anticheat.AntiCheatPlugin;
import com.anticheat.executor.ActionExecutor;
import com.anticheat.tracker.MovementTracker;
import com.anticheat.ws.MessageProtocol;
import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerMoveEvent;

public class MovementListener implements Listener {

    private final AntiCheatPlugin plugin;
    private final MovementTracker tracker;
    private final ActionExecutor executor;
    private final Map<UUID, Long> lastSampleTimes = new java.util.concurrent.ConcurrentHashMap<>();

    public MovementListener(AntiCheatPlugin plugin) {
        this.plugin = plugin;
        this.tracker = plugin.getMovementTracker();
        this.executor = plugin.getActionExecutor();
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onPlayerMove(PlayerMoveEvent event) {
        Player player = event.getPlayer();
        UUID uuid = player.getUniqueId();

        if (executor.isFrozen(uuid)) {
            Location from = event.getFrom();
            Location to = event.getTo();
            if (from.getX() != to.getX() || from.getY() != to.getY() || from.getZ() != to.getZ()) {
                event.setCancelled(true);
            }
            return;
        }

        long now = System.currentTimeMillis();
        Long lastSample = lastSampleTimes.get(uuid);
        if (lastSample != null && (now - lastSample) < plugin.getSampleIntervalMs()) {
            return;
        }
        lastSampleTimes.put(uuid, now);

        tracker.sample(player);

        Map<String, Object> data = tracker.getAggregatedData(uuid);
        long[] timestamps = (long[]) data.remove("timestamps");

        String message = MessageProtocol.playerMove(
                uuid,
                (double) data.get("x"),
                (double) data.get("y"),
                (double) data.get("z"),
                (double) data.get("vx"),
                (double) data.get("vy"),
                (double) data.get("vz"),
                (boolean) data.get("onGround"),
                timestamps != null ? timestamps : new long[0]
        );
        plugin.getWebSocketClient().send(message);
    }
}
