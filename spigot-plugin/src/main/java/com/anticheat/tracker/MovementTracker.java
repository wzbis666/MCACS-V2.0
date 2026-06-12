package com.anticheat.tracker;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.bukkit.Location;
import org.bukkit.entity.Player;

public class MovementTracker {

    private static final int WINDOW_SIZE = 20;
    private static final double FLY_SPEED_THRESHOLD = 0.5;
    private static final double SPEED_VARIANCE_THRESHOLD = 0.15;

    private final Map<UUID, Deque<PositionSample>> playerSamples = new HashMap<>();
    private final Map<UUID, Location> lastPositions = new HashMap<>();
    private final Map<UUID, Long> lastSampleTimes = new HashMap<>();
    private final Map<UUID, Boolean> anomalyFlags = new HashMap<>();

    public static class PositionSample {
        public final double x, y, z;
        public final double vx, vy, vz;
        public final boolean onGround;
        public final long timestamp;

        public PositionSample(double x, double y, double z, double vx, double vy, double vz,
                              boolean onGround, long timestamp) {
            this.x = x;
            this.y = y;
            this.z = z;
            this.vx = vx;
            this.vy = vy;
            this.vz = vz;
            this.onGround = onGround;
            this.timestamp = timestamp;
        }
    }

    public void sample(Player player) {
        UUID uuid = player.getUniqueId();
        Location loc = player.getLocation();
        long now = System.currentTimeMillis();

        Deque<PositionSample> samples = playerSamples.computeIfAbsent(uuid, k -> new ArrayDeque<>());
        Location lastPos = lastPositions.get(uuid);
        Long lastTime = lastSampleTimes.get(uuid);

        double vx = 0, vy = 0, vz = 0;
        if (lastPos != null && lastTime != null) {
            double dt = (now - lastTime) / 1000.0;
            if (dt > 0) {
                vx = (loc.getX() - lastPos.getX()) / dt;
                vy = (loc.getY() - lastPos.getY()) / dt;
                vz = (loc.getZ() - lastPos.getZ()) / dt;
            }
        }

        boolean onGround = player.isOnGround();
        PositionSample sample = new PositionSample(
                loc.getX(), loc.getY(), loc.getZ(),
                vx, vy, vz, onGround, now
        );

        samples.addLast(sample);
        while (samples.size() > WINDOW_SIZE) {
            samples.removeFirst();
        }

        lastPositions.put(uuid, loc.clone());
        lastSampleTimes.put(uuid, now);

        checkAnomalies(uuid, samples);
    }

    private void checkAnomalies(UUID uuid, Deque<PositionSample> samples) {
        if (samples.size() < 5) {
            anomalyFlags.put(uuid, false);
            return;
        }

        double avgHSpeed = 0;
        double avgVSpeed = 0;
        int count = 0;
        for (PositionSample s : samples) {
            double hSpeed = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
            avgHSpeed += hSpeed;
            avgVSpeed += Math.abs(s.vy);
            count++;
        }
        avgHSpeed /= count;
        avgVSpeed /= count;

        boolean flyAnomaly = false;
        boolean speedAnomaly = false;

        if (avgHSpeed > FLY_SPEED_THRESHOLD * 20 || avgVSpeed > FLY_SPEED_THRESHOLD * 20) {
            flyAnomaly = true;
        }

        double varianceSum = 0;
        for (PositionSample s : samples) {
            double hSpeed = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
            double diff = hSpeed - avgHSpeed;
            varianceSum += diff * diff;
        }
        double variance = varianceSum / count;
        if (variance > SPEED_VARIANCE_THRESHOLD) {
            speedAnomaly = true;
        }

        anomalyFlags.put(uuid, flyAnomaly || speedAnomaly);
    }

    public boolean hasAnomaly(UUID uuid) {
        return anomalyFlags.getOrDefault(uuid, false);
    }

    public Map<String, Object> getAggregatedData(UUID uuid) {
        Map<String, Object> data = new HashMap<>();
        Deque<PositionSample> samples = playerSamples.get(uuid);

        if (samples == null || samples.isEmpty()) {
            data.put("uuid", uuid.toString());
            data.put("sampleCount", 0);
            return data;
        }

        PositionSample latest = samples.peekLast();
        double avgHSpeed = 0;
        double avgVSpeed = 0;
        double maxHSpeed = 0;
        double speedVariance = 0;
        int count = samples.size();

        double[] hSpeeds = new double[count];
        int i = 0;
        for (PositionSample s : samples) {
            double hSpeed = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
            hSpeeds[i++] = hSpeed;
            avgHSpeed += hSpeed;
            avgVSpeed += Math.abs(s.vy);
            if (hSpeed > maxHSpeed) maxHSpeed = hSpeed;
        }
        avgHSpeed /= count;
        avgVSpeed /= count;

        double varianceSum = 0;
        for (double hs : hSpeeds) {
            double diff = hs - avgHSpeed;
            varianceSum += diff * diff;
        }
        speedVariance = varianceSum / count;

        long[] timestamps = new long[count];
        i = 0;
        for (PositionSample s : samples) {
            timestamps[i++] = s.timestamp;
        }

        data.put("uuid", uuid.toString());
        data.put("x", latest.x);
        data.put("y", latest.y);
        data.put("z", latest.z);
        data.put("vx", latest.vx);
        data.put("vy", latest.vy);
        data.put("vz", latest.vz);
        data.put("onGround", latest.onGround);
        data.put("avgHSpeed", Math.round(avgHSpeed * 100.0) / 100.0);
        data.put("avgVSpeed", Math.round(avgVSpeed * 100.0) / 100.0);
        data.put("maxHSpeed", Math.round(maxHSpeed * 100.0) / 100.0);
        data.put("speedVariance", Math.round(speedVariance * 10000.0) / 10000.0);
        data.put("anomaly", anomalyFlags.getOrDefault(uuid, false));
        data.put("sampleCount", count);
        data.put("timestamps", timestamps);

        return data;
    }

    public void removePlayer(UUID uuid) {
        playerSamples.remove(uuid);
        lastPositions.remove(uuid);
        lastSampleTimes.remove(uuid);
        anomalyFlags.remove(uuid);
    }

    public void clear() {
        playerSamples.clear();
        lastPositions.clear();
        lastSampleTimes.clear();
        anomalyFlags.clear();
    }
}
