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
    private final Map<UUID, Long> lastAttackTime = new HashMap<>();

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
        Deque<AttackRecord> attacks = playerAttacks.computeIfAbsent(attacker, k -> new ArrayDeque<>());
        attacks.addLast(new AttackRecord(victim, distance, angle, hasLos, now));
        pruneOldRecords(attacks, now);
        lastAttackTime.put(attacker, now);
    }

    public void recordClick(UUID player) {
        long now = System.currentTimeMillis();
        Deque<Long> clicks = playerClicks.computeIfAbsent(player, k -> new ArrayDeque<>());
        clicks.addLast(now);
        pruneOldClicks(clicks, now);
    }

    private void pruneOldRecords(Deque<AttackRecord> attacks, long now) {
        while (!attacks.isEmpty() && (now - attacks.peekFirst().timestamp) > COMBAT_WINDOW_MS) {
            attacks.removeFirst();
        }
    }

    private void pruneOldClicks(Deque<Long> clicks, long now) {
        while (!clicks.isEmpty() && (now - clicks.peekFirst()) > CPS_WINDOW_MS) {
            clicks.removeFirst();
        }
    }

    public double getCPS(UUID player) {
        long now = System.currentTimeMillis();
        Deque<Long> clicks = playerClicks.get(player);
        if (clicks == null) return 0;
        pruneOldClicks(clicks, now);
        return clicks.size();
    }

    public double getHitRate(UUID player) {
        Deque<AttackRecord> attacks = playerAttacks.get(player);
        Deque<Long> clicks = playerClicks.get(player);
        if (clicks == null || clicks.isEmpty()) return 0;
        if (attacks == null || attacks.isEmpty()) return 0;
        long now = System.currentTimeMillis();
        long windowStart = now - COMBAT_WINDOW_MS;
        long attackCount = attacks.stream().filter(a -> a.timestamp >= windowStart).count();
        long clickCount = clicks.size();
        return clickCount > 0 ? (double) attackCount / clickCount : 0;
    }

    public int getUniqueTargetsInWindow(UUID attacker) {
        Deque<AttackRecord> attacks = playerAttacks.get(attacker);
        if (attacks == null) return 0;
        long now = System.currentTimeMillis();
        long windowStart = now - MULTI_TARGET_WINDOW_MS;
        Set<UUID> targets = new HashSet<>();
        for (AttackRecord a : attacks) {
            if (a.timestamp >= windowStart) {
                targets.add(a.victim);
            }
        }
        return targets.size();
    }

    public Map<String, Object> getCombatData(UUID player) {
        Map<String, Object> data = new HashMap<>();
        Deque<AttackRecord> attacks = playerAttacks.get(player);

        data.put("uuid", player.toString());
        data.put("cps", getCPS(player));
        data.put("hitRate", Math.round(getHitRate(player) * 100.0) / 100.0);
        data.put("uniqueTargets", getUniqueTargetsInWindow(player));

        if (attacks == null || attacks.isEmpty()) {
            data.put("avgDistance", 0.0);
            data.put("avgAngle", 0.0);
            data.put("attackCount", 0);
            data.put("losRate", 0.0);
            return data;
        }

        long now = System.currentTimeMillis();
        long windowStart = now - COMBAT_WINDOW_MS;
        List<AttackRecord> recent = new ArrayList<>();
        for (AttackRecord a : attacks) {
            if (a.timestamp >= windowStart) {
                recent.add(a);
            }
        }

        if (recent.isEmpty()) {
            data.put("avgDistance", 0.0);
            data.put("avgAngle", 0.0);
            data.put("attackCount", 0);
            data.put("losRate", 0.0);
            return data;
        }

        double totalDist = 0;
        double totalAngle = 0;
        int losCount = 0;
        for (AttackRecord a : recent) {
            totalDist += a.distance;
            totalAngle += a.angle;
            if (a.hasLos) losCount++;
        }

        data.put("avgDistance", Math.round((totalDist / recent.size()) * 100.0) / 100.0);
        data.put("avgAngle", Math.round((totalAngle / recent.size()) * 100.0) / 100.0);
        data.put("attackCount", recent.size());
        data.put("losRate", Math.round(((double) losCount / recent.size()) * 100.0) / 100.0);

        return data;
    }

    public void removePlayer(UUID uuid) {
        playerAttacks.remove(uuid);
        playerClicks.remove(uuid);
        lastAttackTime.remove(uuid);
    }

    public void clear() {
        playerAttacks.clear();
        playerClicks.clear();
        lastAttackTime.clear();
    }
}
