package com.anticheat.tracker;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.bukkit.Material;

public class BlockTracker {

    private static final int BREAK_WINDOW_SIZE = 100;
    private static final int PLACE_WINDOW_SIZE = 100;

    private static final List<String> VALUABLE_ORES = List.of(
            "DIAMOND_ORE", "DEEPSLATE_DIAMOND_ORE",
            "EMERALD_ORE", "DEEPSLATE_EMERALD_ORE",
            "ANCIENT_DEBRIS",
            "GOLD_ORE", "DEEPSLATE_GOLD_ORE"
    );

    private final Map<UUID, Deque<BreakRecord>> playerBreaks = new HashMap<>();
    private final Map<UUID, Deque<PlaceRecord>> playerPlaces = new HashMap<>();
    private final Map<UUID, Long> lastBreakTime = new HashMap<>();
    private final Map<UUID, Long> lastPlaceTime = new HashMap<>();

    public static class BreakRecord {
        public final String blockType;
        public final double hardness;
        public final double breakTimeMs;
        public final double speed;
        public final long timestamp;

        public BreakRecord(String blockType, double hardness, double breakTimeMs, double speed, long timestamp) {
            this.blockType = blockType;
            this.hardness = hardness;
            this.breakTimeMs = breakTimeMs;
            this.speed = speed;
            this.timestamp = timestamp;
        }
    }

    public static class PlaceRecord {
        public final String blockType;
        public final long timestamp;

        public PlaceRecord(String blockType, long timestamp) {
            this.blockType = blockType;
            this.timestamp = timestamp;
        }
    }

    public void recordBreak(UUID player, String blockType, double hardness, double breakTimeMs) {
        long now = System.currentTimeMillis();
        double speed = breakTimeMs > 0 ? hardness / (breakTimeMs / 1000.0) : 0;

        Deque<BreakRecord> breaks = playerBreaks.computeIfAbsent(player, k -> new ArrayDeque<>());
        breaks.addLast(new BreakRecord(blockType, hardness, breakTimeMs, speed, now));
        while (breaks.size() > BREAK_WINDOW_SIZE) {
            breaks.removeFirst();
        }
        lastBreakTime.put(player, now);
    }

    public void recordPlace(UUID player, String blockType) {
        long now = System.currentTimeMillis();
        Deque<PlaceRecord> places = playerPlaces.computeIfAbsent(player, k -> new ArrayDeque<>());
        places.addLast(new PlaceRecord(blockType, now));
        while (places.size() > PLACE_WINDOW_SIZE) {
            places.removeFirst();
        }
        lastPlaceTime.put(player, now);
    }

    public double getOreRatio(UUID player) {
        Deque<BreakRecord> breaks = playerBreaks.get(player);
        if (breaks == null || breaks.isEmpty()) return 0;
        int valuable = 0;
        for (BreakRecord b : breaks) {
            if (VALUABLE_ORES.contains(b.blockType)) {
                valuable++;
            }
        }
        return (double) valuable / breaks.size();
    }

    public double getAvgBreakSpeed(UUID player) {
        Deque<BreakRecord> breaks = playerBreaks.get(player);
        if (breaks == null || breaks.isEmpty()) return 0;
        double total = 0;
        for (BreakRecord b : breaks) {
            total += b.speed;
        }
        return total / breaks.size();
    }

    public double getPlaceSpeed(UUID player) {
        Deque<PlaceRecord> places = playerPlaces.get(player);
        if (places == null || places.size() < 2) return 0;
        long earliest = places.peekFirst().timestamp;
        long latest = places.peekLast().timestamp;
        long span = latest - earliest;
        if (span <= 0) return places.size();
        return (double) places.size() / (span / 1000.0);
    }

    public String getBreakSequence(UUID player) {
        Deque<BreakRecord> breaks = playerBreaks.get(player);
        if (breaks == null || breaks.isEmpty()) return "";
        StringBuilder sb = new StringBuilder();
        for (BreakRecord b : breaks) {
            if (sb.length() > 0) sb.append(",");
            sb.append(b.blockType);
        }
        return sb.toString();
    }

    public Map<String, Object> getBlockData(UUID player) {
        Map<String, Object> data = new HashMap<>();
        Deque<BreakRecord> breaks = playerBreaks.get(player);
        Deque<PlaceRecord> places = playerPlaces.get(player);

        data.put("uuid", player.toString());
        data.put("breakCount", breaks != null ? breaks.size() : 0);
        data.put("placeCount", places != null ? places.size() : 0);
        data.put("avgBreakSpeed", Math.round(getAvgBreakSpeed(player) * 100.0) / 100.0);
        data.put("oreRatio", Math.round(getOreRatio(player) * 10000.0) / 10000.0);
        data.put("placeSpeed", Math.round(getPlaceSpeed(player) * 100.0) / 100.0);
        data.put("breakSequence", getBreakSequence(player));

        if (breaks != null && !breaks.isEmpty()) {
            BreakRecord last = breaks.peekLast();
            data.put("lastBreakType", last.blockType);
            data.put("lastBreakSpeed", Math.round(last.speed * 100.0) / 100.0);
        }

        return data;
    }

    public void removePlayer(UUID uuid) {
        playerBreaks.remove(uuid);
        playerPlaces.remove(uuid);
        lastBreakTime.remove(uuid);
        lastPlaceTime.remove(uuid);
    }

    public void clear() {
        playerBreaks.clear();
        playerPlaces.clear();
        lastBreakTime.clear();
        lastPlaceTime.clear();
    }
}
