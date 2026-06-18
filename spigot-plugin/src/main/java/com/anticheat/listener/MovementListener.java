package com.anticheat.listener;

import java.util.Collection;
import java.util.Map;
import java.util.UUID;
import com.anticheat.AntiCheatPlugin;
import com.anticheat.executor.ActionExecutor;
import com.anticheat.tracker.MovementTracker;
import com.anticheat.ws.MessageProtocol;
import org.bukkit.Location;
import org.bukkit.entity.Boat;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Minecart;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;

public class MovementListener implements Listener {

    private final AntiCheatPlugin plugin;
    private final MovementTracker tracker;
    private final ActionExecutor executor;
    private final Map<UUID, Long> lastSampleTimes = new java.util.concurrent.ConcurrentHashMap<>();

    // ── 玩家状态追踪（变化时发送 action 事件到后端） ──
    private final Map<UUID, Boolean> wasSprinting = new java.util.concurrent.ConcurrentHashMap<>();
    private final Map<UUID, Integer> lastSpeedAmplifier = new java.util.concurrent.ConcurrentHashMap<>();
    private final Map<UUID, Boolean> wasGliding = new java.util.concurrent.ConcurrentHashMap<>();
    private final Map<UUID, Boolean> wasInVehicle = new java.util.concurrent.ConcurrentHashMap<>();
    private final Map<UUID, Boolean> wasRiptide = new java.util.concurrent.ConcurrentHashMap<>();
    private final Map<UUID, Boolean> wasInWater = new java.util.concurrent.ConcurrentHashMap<>();
    private final Map<UUID, Boolean> wasSwimming = new java.util.concurrent.ConcurrentHashMap<>();

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

        // ── 检测并发送玩家状态变化 ──
        detectAndSendStateChanges(player, uuid);

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

    /**
     * 检测玩家状态变化，仅在状态变化时发送 action 事件到后端。
     * 包括：疾跑、速度药水、鞘翅飞行、骑乘、激流三叉戟。
     */
    private void detectAndSendStateChanges(Player player, UUID uuid) {
        // ── 疾跑状态 ──
        boolean isSprinting = player.isSprinting();
        if (isSprinting != wasSprinting.getOrDefault(uuid, false)) {
            plugin.getWebSocketClient().send(
                    MessageProtocol.playerAction(uuid, "sprinting", isSprinting));
            wasSprinting.put(uuid, isSprinting);
        }

        // ── 速度药水等级 ──
        int speedAmplifier = -1;
        Collection<PotionEffect> effects = player.getActivePotionEffects();
        for (PotionEffect effect : effects) {
            if (effect.getType().equals(PotionEffectType.SPEED)) {
                speedAmplifier = effect.getAmplifier(); // 0=Speed I, 1=Speed II, ...
                break;
            }
        }
        int prevAmplifier = lastSpeedAmplifier.getOrDefault(uuid, -1);
        if (speedAmplifier != prevAmplifier) {
            // 发送速度药水等级变化
            if (speedAmplifier >= 1) {
                // Speed II 及以上
                plugin.getWebSocketClient().send(
                        MessageProtocol.playerAction(uuid, "speed_effect_2", true));
            } else {
                plugin.getWebSocketClient().send(
                        MessageProtocol.playerAction(uuid, "speed_effect_2", false));
            }
            if (speedAmplifier >= 0) {
                // Speed I 及以上
                plugin.getWebSocketClient().send(
                        MessageProtocol.playerAction(uuid, "speed_effect", true));
            } else {
                plugin.getWebSocketClient().send(
                        MessageProtocol.playerAction(uuid, "speed_effect", false));
            }
            lastSpeedAmplifier.put(uuid, speedAmplifier);
        }

        // ── 鞘翅飞行 ──
        boolean isGliding = player.isGliding();
        if (isGliding != wasGliding.getOrDefault(uuid, false)) {
            plugin.getWebSocketClient().send(
                    MessageProtocol.playerAction(uuid, "elytra_flying", isGliding));
            wasGliding.put(uuid, isGliding);
        }

        // ── 骑乘状态（船、矿车、马等） ──
        boolean isInVehicle = player.isInsideVehicle();
        if (isInVehicle != wasInVehicle.getOrDefault(uuid, false)) {
            Entity vehicle = player.getVehicle();
            String vehicleType = "vehicle";
            if (vehicle != null) {
                if (vehicle instanceof Boat) {
                    vehicleType = "vehicle_boat";
                } else if (vehicle instanceof Minecart) {
                    vehicleType = "vehicle_minecart";
                } else {
                    vehicleType = "vehicle_mount"; // 马、猪、炽足兽等
                }
            }
            plugin.getWebSocketClient().send(
                    MessageProtocol.playerAction(uuid, vehicleType, isInVehicle));
            // 同时发送通用 vehicle 标记
            plugin.getWebSocketClient().send(
                    MessageProtocol.playerAction(uuid, "vehicle", isInVehicle));
            wasInVehicle.put(uuid, isInVehicle);
        }

        // ── 激流三叉戟（Riptide） ──
        // 激流效果通过 PotionEffect 实现（Minecraft 1.13+）
        boolean isRiptide = false;
        for (PotionEffect effect : effects) {
            // 激流没有独立 PotionEffect，但玩家在水中使用激流时会有短暂的
            // 高速移动。通过检测 CONDUIT_POWER 或直接检查 riptide 状态
            // Paper API: Player.hasRiptide() 不可用
            // 替代方案：检测玩家是否在水中且有极高速度（由后端处理）
            break;
        }
        // 使用 attack cooldown 追踪（简化：通过 isRiptiding 标记）
        // Paper 1.20.4 中 Player 有 isRiptiding() 方法
        try {
            isRiptide = player.isRiptiding();
        } catch (NoSuchMethodError ignored) {
            // 旧版本不支持，跳过
        }
        if (isRiptide != wasRiptide.getOrDefault(uuid, false)) {
            plugin.getWebSocketClient().send(
                    MessageProtocol.playerAction(uuid, "riptiding", isRiptide));
            wasRiptide.put(uuid, isRiptide);
        }

        // ── 水中状态 ──
        boolean isInWater = player.isInWater();
        if (isInWater != wasInWater.getOrDefault(uuid, false)) {
            plugin.getWebSocketClient().send(
                    MessageProtocol.playerAction(uuid, "in_water", isInWater));
            wasInWater.put(uuid, isInWater);
        }

        // ── 游泳状态（1.13+ 水中游泳/上浮） ──
        boolean isSwimming = false;
        try {
            isSwimming = player.isSwimming();
        } catch (NoSuchMethodError ignored) {
            // 旧版本不支持
        }
        if (isSwimming != wasSwimming.getOrDefault(uuid, false)) {
            plugin.getWebSocketClient().send(
                    MessageProtocol.playerAction(uuid, "swimming", isSwimming));
            wasSwimming.put(uuid, isSwimming);
        }
    }

    /** 玩家退出时清理状态追踪 */
    public void removePlayer(UUID uuid) {
        lastSampleTimes.remove(uuid);
        wasSprinting.remove(uuid);
        lastSpeedAmplifier.remove(uuid);
        wasGliding.remove(uuid);
        wasInVehicle.remove(uuid);
        wasRiptide.remove(uuid);
        wasInWater.remove(uuid);
        wasSwimming.remove(uuid);
    }
}
