package com.anticheat.listener;

import java.util.Map;
import java.util.List;
import java.util.ArrayList;
import java.util.Set;
import java.util.UUID;
import com.anticheat.AntiCheatPlugin;
import com.anticheat.executor.ActionExecutor;
import com.anticheat.tracker.BlockTracker;
import com.anticheat.ws.MessageProtocol;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.json.simple.JSONObject;

public class BlockListener implements Listener {

    private static final int ORE_SCAN_RADIUS = 4;
    private static final int MAX_NEARBY_ORES = 32;
    private static final Set<Material> ORE_TYPES = Set.of(
            Material.DIAMOND_ORE, Material.DEEPSLATE_DIAMOND_ORE,
            Material.EMERALD_ORE, Material.DEEPSLATE_EMERALD_ORE,
            Material.GOLD_ORE, Material.DEEPSLATE_GOLD_ORE,
            Material.IRON_ORE, Material.DEEPSLATE_IRON_ORE,
            Material.LAPIS_ORE, Material.DEEPSLATE_LAPIS_ORE,
            Material.REDSTONE_ORE, Material.DEEPSLATE_REDSTONE_ORE,
            Material.ANCIENT_DEBRIS);
    private static final BlockFace[] ADJACENT_FACES = {
            BlockFace.UP, BlockFace.DOWN, BlockFace.NORTH,
            BlockFace.SOUTH, BlockFace.EAST, BlockFace.WEST
    };

    private final AntiCheatPlugin plugin;
    private final BlockTracker tracker;
    private final ActionExecutor executor;

    private final Map<UUID, Long> breakStartTimes = new java.util.concurrent.ConcurrentHashMap<>();
    private final Map<UUID, Long> lastPlacementTimes = new java.util.concurrent.ConcurrentHashMap<>();

    public BlockListener(AntiCheatPlugin plugin) {
        this.plugin = plugin;
        this.tracker = plugin.getBlockTracker();
        this.executor = plugin.getActionExecutor();
    }

    @EventHandler(priority = EventPriority.LOWEST)
    public void onBlockBreak(BlockBreakEvent event) {
        // 冻结状态下禁止破坏方块
        if (executor.isFrozen(event.getPlayer().getUniqueId())) {
            event.setCancelled(true);
            return;
        }
        Player player = event.getPlayer();
        UUID uuid = player.getUniqueId();
        Block block = event.getBlock();
        Material material = block.getType();

        Long startTime = breakStartTimes.remove(uuid);
        double breakTimeMs = startTime != null ? (System.currentTimeMillis() - startTime) : 0;

        double hardness = getHardness(material);

        tracker.recordBreak(uuid, material.name(), hardness, breakTimeMs);

        String sequence = tracker.getBreakSequence(uuid);
        int exposedFaces = countExposedFaces(block);
        List<JSONObject> nearbyOres = scanNearbyOres(block);

        String message = MessageProtocol.playerBlock(
                uuid, "break", material.name(),
                breakTimeMs > 0 ? hardness / (breakTimeMs / 1000.0) : 0,
                sequence,
                block.getX(), block.getY(), block.getZ(),
                exposedFaces, nearbyOres,
                player.getLocation().getYaw(), player.getLocation().getPitch(), "", 0L
        );
        plugin.getWebSocketClient().send(message);
    }

    @EventHandler(priority = EventPriority.LOWEST)
    public void onBlockBreakStart(PlayerInteractEvent event) {
        // 冻结状态下禁止交互
        if (executor.isFrozen(event.getPlayer().getUniqueId())) {
            event.setCancelled(true);
            return;
        }
        if (event.getAction() == Action.LEFT_CLICK_BLOCK && event.getClickedBlock() != null) {
            breakStartTimes.put(
                event.getPlayer().getUniqueId(),
                System.currentTimeMillis()
            );
        }
    }

    @EventHandler(priority = EventPriority.LOWEST)
    public void onBlockPlace(BlockPlaceEvent event) {
        // 冻结状态下禁止放置方块
        if (executor.isFrozen(event.getPlayer().getUniqueId())) {
            event.setCancelled(true);
            return;
        }
        Player player = event.getPlayer();
        UUID uuid = player.getUniqueId();
        Material material = event.getBlock().getType();

        tracker.recordPlace(uuid, material.name());

        String sequence = tracker.getBreakSequence(uuid);
        long placedAt = System.currentTimeMillis();
        long placementIntervalMs = lastPlacementTimes.containsKey(uuid)
                ? placedAt - lastPlacementTimes.get(uuid) : 0L;
        lastPlacementTimes.put(uuid, placedAt);
        BlockFace placedFace = event.getBlockPlaced().getFace(event.getBlockAgainst());

        String message = MessageProtocol.playerBlock(
                uuid, "place", material.name(),
                tracker.getPlaceSpeed(uuid),
                sequence,
                event.getBlock().getX(), event.getBlock().getY(), event.getBlock().getZ(),
                countExposedFaces(event.getBlock()), List.of(),
                player.getLocation().getYaw(), player.getLocation().getPitch(),
                placedFace == null ? "UNKNOWN" : placedFace.name(), placementIntervalMs
        );
        plugin.getWebSocketClient().send(message);
    }

    private int countExposedFaces(Block block) {
        int exposed = 0;
        for (BlockFace face : ADJACENT_FACES) {
            if (block.getRelative(face).getType().isAir()) exposed++;
        }
        return exposed;
    }

    @SuppressWarnings("unchecked")
    private List<JSONObject> scanNearbyOres(Block origin) {
        List<JSONObject> ores = new ArrayList<>();
        for (int dx = -ORE_SCAN_RADIUS; dx <= ORE_SCAN_RADIUS; dx++) {
            for (int dy = -ORE_SCAN_RADIUS; dy <= ORE_SCAN_RADIUS; dy++) {
                for (int dz = -ORE_SCAN_RADIUS; dz <= ORE_SCAN_RADIUS; dz++) {
                    if (ores.size() >= MAX_NEARBY_ORES) return ores;
                    Block candidate = origin.getRelative(dx, dy, dz);
                    if (!ORE_TYPES.contains(candidate.getType())) continue;
                    JSONObject ore = new JSONObject();
                    ore.put("type", candidate.getType().name());
                    ore.put("dx", dx);
                    ore.put("dy", dy);
                    ore.put("dz", dz);
                    ore.put("exposed", countExposedFaces(candidate) > 0);
                    ores.add(ore);
                }
            }
        }
        return ores;
    }

    private double getHardness(Material material) {
        return switch (material.name()) {
            case "STONE", "COBBLESTONE", "MOSSY_COBBLESTONE" -> 1.5;
            case "DIAMOND_ORE", "DEEPSLATE_DIAMOND_ORE" -> 3.0;
            case "EMERALD_ORE", "DEEPSLATE_EMERALD_ORE" -> 3.0;
            case "GOLD_ORE", "DEEPSLATE_GOLD_ORE" -> 3.0;
            case "IRON_ORE", "DEEPSLATE_IRON_ORE" -> 3.0;
            case "COAL_ORE", "DEEPSLATE_COAL_ORE" -> 3.0;
            case "LAPIS_ORE", "DEEPSLATE_LAPIS_ORE" -> 3.0;
            case "REDSTONE_ORE", "DEEPSLATE_REDSTONE_ORE" -> 3.0;
            case "COPPER_ORE", "DEEPSLATE_COPPER_ORE" -> 3.0;
            case "ANCIENT_DEBRIS" -> 30.0;
            case "NETHERITE_BLOCK" -> 50.0;
            case "OBSIDIAN" -> 50.0;
            case "CRYING_OBSIDIAN" -> 50.0;
            case "ENDER_CHEST" -> 22.5;
            case "ANVIL" -> 5.0;
            case "IRON_BLOCK" -> 5.0;
            case "GOLD_BLOCK" -> 5.0;
            case "DIAMOND_BLOCK" -> 5.0;
            case "EMERALD_BLOCK" -> 5.0;
            case "DEEPSLATE" -> 3.0;
            case "COBBLED_DEEPSLATE" -> 3.0;
            case "BEDROCK" -> -1.0;
            default -> 1.0;
        };
    }
}
