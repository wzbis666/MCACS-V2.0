package com.anticheat.listener;

import java.util.Map;
import java.util.UUID;
import com.anticheat.AntiCheatPlugin;
import com.anticheat.tracker.BlockTracker;
import com.anticheat.ws.MessageProtocol;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.player.PlayerInteractEvent;

public class BlockListener implements Listener {

    private final AntiCheatPlugin plugin;
    private final BlockTracker tracker;

    private final Map<UUID, Long> breakStartTimes = new java.util.concurrent.ConcurrentHashMap<>();

    public BlockListener(AntiCheatPlugin plugin) {
        this.plugin = plugin;
        this.tracker = plugin.getBlockTracker();
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onBlockBreak(BlockBreakEvent event) {
        Player player = event.getPlayer();
        UUID uuid = player.getUniqueId();
        Block block = event.getBlock();
        Material material = block.getType();

        Long startTime = breakStartTimes.remove(uuid);
        double breakTimeMs = startTime != null ? (System.currentTimeMillis() - startTime) : 0;

        double hardness = getHardness(material);

        tracker.recordBreak(uuid, material.name(), hardness, breakTimeMs);

        String sequence = tracker.getBreakSequence(uuid);

        String message = MessageProtocol.playerBlock(
                uuid, "break", material.name(),
                breakTimeMs > 0 ? hardness / (breakTimeMs / 1000.0) : 0,
                sequence
        );
        plugin.getWebSocketClient().send(message);
    }

    @EventHandler(priority = EventPriority.LOWEST)
    public void onBlockBreakStart(PlayerInteractEvent event) {
        if (event.getAction() == Action.LEFT_CLICK_BLOCK && event.getClickedBlock() != null) {
            breakStartTimes.put(
                event.getPlayer().getUniqueId(),
                System.currentTimeMillis()
            );
        }
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onBlockPlace(BlockPlaceEvent event) {
        Player player = event.getPlayer();
        UUID uuid = player.getUniqueId();
        Material material = event.getBlock().getType();

        tracker.recordPlace(uuid, material.name());

        String sequence = tracker.getBreakSequence(uuid);

        String message = MessageProtocol.playerBlock(
                uuid, "place", material.name(),
                tracker.getPlaceSpeed(uuid),
                sequence
        );
        plugin.getWebSocketClient().send(message);
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
