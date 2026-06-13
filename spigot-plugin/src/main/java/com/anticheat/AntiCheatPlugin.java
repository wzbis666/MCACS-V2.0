package com.anticheat;

import com.anticheat.executor.ActionExecutor;
import com.anticheat.listener.BlockListener;
import com.anticheat.listener.CombatListener;
import com.anticheat.listener.MovementListener;
import com.anticheat.listener.PlayerListener;
import com.anticheat.tracker.BlockTracker;
import com.anticheat.tracker.CombatTracker;
import com.anticheat.tracker.MovementTracker;
import com.anticheat.ws.MessageProtocol;
import com.anticheat.ws.WebSocketClient;
import org.bukkit.Bukkit;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;
import org.json.simple.JSONObject;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

public class AntiCheatPlugin extends JavaPlugin {

    private String wsUri;
    private WebSocketClient wsClient;
    private MovementTracker movementTracker;
    private CombatTracker combatTracker;
    private BlockTracker blockTracker;
    private ActionExecutor actionExecutor;
    private long sampleIntervalMs;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        wsUri = buildWsUri();
        sampleIntervalMs = getConfig().getLong("sample-interval", 250L);
        movementTracker = new MovementTracker();
        combatTracker = new CombatTracker();
        blockTracker = new BlockTracker();

        actionExecutor = new ActionExecutor(this, null);

        wsClient = new WebSocketClient(wsUri, new WebSocketClient.ActionCallback() {
            @Override
            public void onAction(JSONObject message) {
                actionExecutor.executeAction(message);
            }

            @Override
            public void onConnected() {
                getLogger().info("[AntiCheat] Connected to control layer at " + wsUri);
                String serverId = getConfig().getString("server-name", "server-" + Integer.toHexString(getServer().getPort()));
                wsClient.send(MessageProtocol.serverStart(
                        serverId,
                        getServer().getMaxPlayers(),
                        getServer().getBukkitVersion()
                ));

                // Send all currently online players so the backend can sync state
                for (org.bukkit.entity.Player player : getServer().getOnlinePlayers()) {
                    wsClient.send(MessageProtocol.playerJoin(
                            player.getUniqueId(),
                            player.getName(),
                            player.getAddress() != null ? player.getAddress().getAddress().getHostAddress() : "unknown",
                            player.getGameMode().name().toLowerCase()
                    ));
                }
            }

            @Override
            public void onDisconnected() {
                getLogger().warning("[AntiCheat] Disconnected from control layer");
            }
        });

        actionExecutor.setWsClient(wsClient);

        getServer().getPluginManager().registerEvents(new MovementListener(this), this);
        getServer().getPluginManager().registerEvents(new CombatListener(this), this);
        getServer().getPluginManager().registerEvents(new BlockListener(this), this);
        getServer().getPluginManager().registerEvents(new PlayerListener(this), this);

        wsClient.connect();

        getLogger().info("AntiCheatMonitor enabled - connecting to " + wsUri);
    }

    @Override
    public void onDisable() {
        if (wsClient != null) {
            wsClient.shutdown();
        }
        if (movementTracker != null) movementTracker.clear();
        if (combatTracker != null) combatTracker.clear();
        if (blockTracker != null) blockTracker.clear();
        if (actionExecutor != null) actionExecutor.clear();

        getLogger().info("AntiCheatMonitor disabled");
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!command.getName().equalsIgnoreCase("anticheat")) return false;
        if (!sender.hasPermission("anticheat.admin")) {
            sender.sendMessage("§cYou don't have permission to use this command.");
            return true;
        }

        if (args.length == 0) {
            sendStatus(sender);
            return true;
        }

        switch (args[0].toLowerCase()) {
            case "reload" -> {
                reloadConfig();
                wsUri = buildWsUri();
                sampleIntervalMs = getConfig().getLong("sample-interval", 250L);
                wsClient.disconnect();
                wsClient.connect();
                sender.sendMessage("§a[AntiCheat] WebSocket reconnected.");
            }
            case "status" -> sendStatus(sender);
            default -> sender.sendMessage("§cUsage: /anticheat <reload|status>");
        }
        return true;
    }

    private void sendStatus(CommandSender sender) {
        sender.sendMessage("§6[AntiCheat] Status:");
        sender.sendMessage("§7  WebSocket: " + (wsClient.isConnected() ? "§aConnected" : "§cDisconnected"));
        sender.sendMessage("§7  Target: " + wsUri);
        sender.sendMessage("§7  Online players: " + Bukkit.getOnlinePlayers().size());
        sender.sendMessage("§7  Movement samples: " + countMovementSamples());
        sender.sendMessage("§7  Combat records: " + countCombatRecords());
        sender.sendMessage("§7  Block records: " + countBlockRecords());
    }

    private int countMovementSamples() {
        int count = 0;
        for (Player p : Bukkit.getOnlinePlayers()) {
            var data = movementTracker.getAggregatedData(p.getUniqueId());
            count += (int) data.getOrDefault("sampleCount", 0);
        }
        return count;
    }

    private int countCombatRecords() {
        int count = 0;
        for (Player p : Bukkit.getOnlinePlayers()) {
            var data = combatTracker.getCombatData(p.getUniqueId());
            count += (int) data.getOrDefault("attackCount", 0);
        }
        return count;
    }

    private int countBlockRecords() {
        int count = 0;
        for (Player p : Bukkit.getOnlinePlayers()) {
            var data = blockTracker.getBlockData(p.getUniqueId());
            count += (int) data.getOrDefault("breakCount", 0);
            count += (int) data.getOrDefault("placeCount", 0);
        }
        return count;
    }

    public WebSocketClient getWebSocketClient() {
        return wsClient;
    }

    public MovementTracker getMovementTracker() {
        return movementTracker;
    }

    public CombatTracker getCombatTracker() {
        return combatTracker;
    }

    public BlockTracker getBlockTracker() {
        return blockTracker;
    }

    public ActionExecutor getActionExecutor() {
        return actionExecutor;
    }

    public long getSampleIntervalMs() {
        return sampleIntervalMs;
    }

    private String buildWsUri() {
        String uri = getConfig().getString("ws-uri", "ws://localhost:55211/spigot");
        String token = getConfig().getString("auth-token", "");
        if (token == null || token.isBlank() || uri.contains("token=")) {
            return uri;
        }
        String separator = uri.contains("?") ? "&" : "?";
        return uri + separator + "token=" + URLEncoder.encode(token, StandardCharsets.UTF_8);
    }
}
