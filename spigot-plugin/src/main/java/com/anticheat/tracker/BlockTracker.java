package com.anticheat.tracker;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public class BlockTracker {
    private static final int WINDOW_SIZE = 100;
    private static final List<String> VALUABLE_ORES = List.of(
            "DIAMOND_ORE", "DEEPSLATE_DIAMOND_ORE", "EMERALD_ORE",
            "DEEPSLATE_EMERALD_ORE", "ANCIENT_DEBRIS", "GOLD_ORE", "DEEPSLATE_GOLD_ORE");
    private final Map<UUID, Deque<BreakRecord>> playerBreaks = new HashMap<>();
    private final Map<UUID, Deque<PlaceRecord>> playerPlaces = new HashMap<>();

    public static class BreakRecord {
        public final String blockType;
        public final double speed;
        public final long timestamp;
        public BreakRecord(String blockType, double speed, long timestamp) {
            this.blockType = blockType;
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
        double speed = breakTimeMs > 0 ? hardness / (breakTimeMs / 1000.0) : 0;
        Deque<BreakRecord> breaks = playerBreaks.computeIfAbsent(player, key -> new ArrayDeque<>());
        breaks.addLast(new BreakRecord(blockType, speed, System.currentTimeMillis()));
        while (breaks.size() > WINDOW_SIZE) breaks.removeFirst();
    }

    public void recordPlace(UUID player, String blockType) {
        Deque<PlaceRecord> places = playerPlaces.computeIfAbsent(player, key -> new ArrayDeque<>());
        places.addLast(new PlaceRecord(blockType, System.currentTimeMillis()));
        while (places.size() > WINDOW_SIZE) places.removeFirst();
    }

    public double getOreRatio(UUID player) {
        Deque<BreakRecord> breaks = playerBreaks.get(player);
        if (breaks == null || breaks.isEmpty()) return 0;
        long valuable = breaks.stream().filter(record -> VALUABLE_ORES.contains(record.blockType)).count();
        return (double) valuable / breaks.size();
    }

    public double getAvgBreakSpeed(UUID player) {
        Deque<BreakRecord> breaks = playerBreaks.get(player);
        if (breaks == null || breaks.isEmpty()) return 0;
        return breaks.stream().mapToDouble(record -> record.speed).average().orElse(0);
    }

    public double getPlaceSpeed(UUID player) {
        Deque<PlaceRecord> places = playerPlaces.get(player);
        if (places == null || places.size() < 2) return 0;
        long span = places.peekLast().timestamp - places.peekFirst().timestamp;
        return span <= 0 ? places.size() : places.size() / (span / 1000.0);
    }

    public String getBreakSequence(UUID player) {
        Deque<BreakRecord> breaks = playerBreaks.get(player);
        if (breaks == null) return "";
        return String.join(",", breaks.stream().map(record -> record.blockType).toList());
    }

    public Map<String, Object> getBlockData(UUID player) {
        Map<String, Object> data = new HashMap<>();
        Deque<BreakRecord> breaks = playerBreaks.get(player);
        Deque<PlaceRecord> places = playerPlaces.get(player);
        data.put("uuid", player.toString());
        data.put("breakCount", breaks == null ? 0 : breaks.size());
        data.put("placeCount", places == null ? 0 : places.size());
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
    }

    public void clear() {
        playerBreaks.clear();
        playerPlaces.clear();
    }
}
