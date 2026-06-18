package com.anticheat.listener;

import java.util.UUID;
import com.anticheat.AntiCheatPlugin;
import com.anticheat.executor.ActionExecutor;
import com.anticheat.tracker.CombatTracker;
import com.anticheat.ws.MessageProtocol;
import org.bukkit.entity.Entity;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.player.PlayerAnimationEvent;
import org.bukkit.util.Vector;

public class CombatListener implements Listener {

    private final AntiCheatPlugin plugin;
    private final CombatTracker tracker;
    private final ActionExecutor executor;

    public CombatListener(AntiCheatPlugin plugin) {
        this.plugin = plugin;
        this.tracker = plugin.getCombatTracker();
        this.executor = plugin.getActionExecutor();
    }

    @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
    public void onEntityDamageByEntity(EntityDamageByEntityEvent event) {
        Entity damager = event.getDamager();
        Entity victim = event.getEntity();

        if (!(damager instanceof Player attacker)) return;

        // 冻结状态下禁止攻击
        if (executor.isFrozen(attacker.getUniqueId())) {
            event.setCancelled(true);
            return;
        }

        tracker.recordClick(attacker.getUniqueId());

        if (!(victim instanceof Player victimPlayer)) return;

        UUID attackerUuid = attacker.getUniqueId();
        UUID victimUuid = victimPlayer.getUniqueId();

        double distance = attacker.getLocation().distance(victimPlayer.getLocation());

        double angle = calculateAngle(attacker, victimPlayer);

        boolean hasLos = hasLineOfSight(attacker, victimPlayer);

        tracker.recordAttack(attackerUuid, victimUuid, distance, angle, hasLos);

        double cps = tracker.getCPS(attackerUuid);

        String message = MessageProtocol.playerCombat(
                attackerUuid, victimUuid, distance, angle, cps, hasLos
        );
        plugin.getWebSocketClient().send(message);
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onPlayerAnimation(PlayerAnimationEvent event) {
        Player player = event.getPlayer();
        tracker.recordClick(player.getUniqueId());
    }

    private double calculateAngle(Player attacker, Player victim) {
        Vector attackerDir = attacker.getLocation().getDirection();
        Vector toVictim = victim.getLocation().toVector()
                .subtract(attacker.getLocation().toVector())
                .normalize();
        return Math.toDegrees(attackerDir.angle(toVictim));
    }

    private boolean hasLineOfSight(Player attacker, Player victim) {
        return attacker.hasLineOfSight(victim);
    }
}
