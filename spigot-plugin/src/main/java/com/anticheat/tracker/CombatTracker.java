package com.anticheat.tracker;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

public class CombatTracker {
    private static final long COMBAT_WINDOW_MS = 60_000;
    private static final long CPS_WINDOW_MS = 1_000;
    private static final long MULTI_TARGET_WINDOW_MS = 1_000;
    private final Map<UUID, Deque<AttackRecord>> playerAttacks = new HashMap<>();
    private final Map<UUID, Deque<Long>> playerClicks = new HashMap<>();

    public static class AttackRecord {
        public final UUID victim;
        public final double distance;
        public final double angle;
        public final boolean hasLos;
        public final long timestamp;

        public AttackRecord(UUID victim, double distance, double angle, boolean hasLos, long timestamp) {
            this.victim = victim;
            this.distance = distance;
            this.angle = angle;
            this.hasLos = hasLos;
            this.timestamp = timestamp;
        }
    }

    public void recordAttack(UUID attacker, UUID victim, double distance, double angle, boolean hasLos) {
        long now = System.currentTimeMillis();
        Deque<AttackRecord> attacks = playerAttacks.computeIfAbsent(attacker, key -> new ArrayDeque<>());
        attacks.addLast(new AttackRecord(victim, distance, angle, hasLos, now));
        while (!attacks.isEmpty() && now - attacks.peekFirst().timestamp > COMBAT_WINDOW_MS) attacks.removeFirst();
    }

    public void recordClick(UUID player) {
        long now = System.currentTimeMillis();
        Deque<Long> clicks = playerClicks.computeIfAbsent(player, key -> new ArrayDeque<>());
        clicks.addLast(now);
        pruneClicks(clicks, now);
    }

    public double getCPS(UUID player) {
        Deque<Long> clicks = playerClicks.get(player);
        if (clicks == null) return 0;
        pruneClicks(clicks, System.currentTimeMillis());
        return clicks.size();
    }

    public double getHitRate(UUID player) {
        Deque<AttackRecord> attacks = playerAttacks.get(player);
        Deque<Long> clicks = playerClicks.get(player);
        if (attacks == null || clicks == null || clicks.isEmpty()) return 0;
        return (double) attacks.size() / clicks.size();
    }

    public int getUniqueTargetsInWindow(UUID attacker) {
        Deque<AttackRecord> attacks = playerAttacks.get(attacker);
        if (attacks == null) return 0;
        long cutoff = System.currentTimeMillis() - MULTI_TARGET_WINDOW_MS;
        Set<UUID> targets = new HashSet<>();
        for (AttackRecord attack : attacks) if (attack.timestamp >= cutoff) targets.add(attack.victim);
        return targets.size();
    }

    public Map<String, Object> getCombatData(UUID player) {
        Map<String, Object> data = new HashMap<>();
        Deque<AttackRecord> attacks = playerAttacks.get(player);
        List<AttackRecord> recent = attacks == null ? List.of() : new ArrayList<>(attacks);
        double totalDistance = 0;
        double totalAngle = 0;
        int losCount = 0;
        for (AttackRecord attack : recent) {
            totalDistance += attack.distance;
            totalAngle += attack.angle;
            if (attack.hasLos) losCount++;
        }
        data.put("uuid", player.toString());
        data.put("cps", getCPS(player));
        data.put("hitRate", Math.round(getHitRate(player) * 100.0) / 100.0);
        data.put("uniqueTargets", getUniqueTargetsInWindow(player));
        data.put("avgDistance", recent.isEmpty() ? 0.0 : Math.round(totalDistance / recent.size() * 100.0) / 100.0);
        data.put("avgAngle", recent.isEmpty() ? 0.0 : Math.round(totalAngle / recent.size() * 100.0) / 100.0);
        data.put("attackCount", recent.size());
        data.put("losRate", recent.isEmpty() ? 0.0 : Math.round((double) losCount / recent.size() * 100.0) / 100.0);
        return data;
    }

    public void removePlayer(UUID uuid) {
        playerAttacks.remove(uuid);
        playerClicks.remove(uuid);
    }

    public void clear() {
        playerAttacks.clear();
        playerClicks.clear();
    }

    private void pruneClicks(Deque<Long> clicks, long now) {
        while (!clicks.isEmpty() && now - clicks.peekFirst() > CPS_WINDOW_MS) clicks.removeFirst();
    }
}
