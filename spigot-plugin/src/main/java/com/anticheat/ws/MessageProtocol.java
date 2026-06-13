package com.anticheat.ws;

import java.util.UUID;
import org.json.simple.JSONArray;
import org.json.simple.JSONObject;
import org.json.simple.JSONValue;
import org.json.simple.parser.JSONParser;

public final class MessageProtocol {

    private MessageProtocol() {}

    public static final String TYPE_SERVER_START = "server_start";
    public static final String TYPE_PLAYER_JOIN = "player_join";
    public static final String TYPE_PLAYER_LEAVE = "player_leave";
    public static final String TYPE_PLAYER_MOVE = "player_move";
    public static final String TYPE_PLAYER_COMBAT = "player_combat";
    public static final String TYPE_PLAYER_BLOCK = "player_block";
    public static final String TYPE_PLAYER_ACTION = "player_action";
    public static final String TYPE_GAME_MODE_CHANGE = "game_mode_change";
    public static final String TYPE_ACTION_EXECUTED = "action_executed";
    public static final String TYPE_HEARTBEAT = "heartbeat";
    public static final String TYPE_BAN_EXECUTED = "ban_executed";
    public static final String TYPE_UNBAN_EXECUTED = "unban_executed";

    public static final String ACTION_KICK = "kick";
    public static final String ACTION_BAN = "ban";
    public static final String ACTION_UNBAN = "unban";
    public static final String ACTION_WHITELIST_ADD = "whitelist_add";
    public static final String ACTION_WHITELIST_REMOVE = "whitelist_remove";
    public static final String ACTION_TELEPORT = "teleport";
    public static final String ACTION_FREEZE = "freeze";
    public static final String ACTION_WARNING = "warning";
    public static final String ACTION_VP_UPDATE = "vp_update";

    @SuppressWarnings("unchecked")
    public static String serverStart(String serverId, int maxPlayers, String version) {
        JSONObject msg = new JSONObject();
        msg.put("type", TYPE_SERVER_START);
        msg.put("serverId", serverId);
        msg.put("maxPlayers", maxPlayers);
        msg.put("version", version);
        msg.put("timestamp", System.currentTimeMillis());
        return msg.toJSONString();
    }

    @SuppressWarnings("unchecked")
    public static String playerJoin(UUID uuid, String name, String ip, String gameMode) {
        JSONObject msg = new JSONObject();
        msg.put("type", TYPE_PLAYER_JOIN);
        msg.put("uuid", uuid.toString());
        msg.put("name", name);
        msg.put("ip", ip);
        msg.put("gameMode", gameMode);
        msg.put("timestamp", System.currentTimeMillis());
        return msg.toJSONString();
    }

    @SuppressWarnings("unchecked")
    public static String playerLeave(UUID uuid, String reason, String exitType) {
        JSONObject msg = new JSONObject();
        msg.put("type", TYPE_PLAYER_LEAVE);
        msg.put("uuid", uuid.toString());
        msg.put("reason", reason);
        msg.put("exitType", exitType);
        msg.put("timestamp", System.currentTimeMillis());
        return msg.toJSONString();
    }

    /** Backward-compatible overload: defaults to normal exit */
    public static String playerLeave(UUID uuid, String reason) {
        return playerLeave(uuid, reason, "normal");
    }

    @SuppressWarnings("unchecked")
    public static String playerMove(UUID uuid, double x, double y, double z,
                                    double vx, double vy, double vz,
                                    boolean onGround, long[] timestamps) {
        JSONObject msg = new JSONObject();
        msg.put("type", TYPE_PLAYER_MOVE);
        msg.put("uuid", uuid.toString());
        msg.put("x", x);
        msg.put("y", y);
        msg.put("z", z);
        msg.put("vx", vx);
        msg.put("vy", vy);
        msg.put("vz", vz);
        msg.put("onGround", onGround);
        JSONArray tsArr = new JSONArray();
        for (long ts : timestamps) {
            tsArr.add(ts);
        }
        msg.put("timestamps", tsArr);
        msg.put("timestamp", System.currentTimeMillis());
        return msg.toJSONString();
    }

    @SuppressWarnings("unchecked")
    public static String playerCombat(UUID attacker, UUID victim,
                                      double distance, double angle,
                                      double cps, boolean hasLos) {
        JSONObject msg = new JSONObject();
        msg.put("type", TYPE_PLAYER_COMBAT);
        msg.put("attacker", attacker.toString());
        msg.put("victim", victim.toString());
        msg.put("distance", distance);
        msg.put("angle", angle);
        msg.put("cps", cps);
        msg.put("hasLos", hasLos);
        msg.put("timestamp", System.currentTimeMillis());
        return msg.toJSONString();
    }

    @SuppressWarnings("unchecked")
    public static String playerBlock(UUID uuid, String action,
                                     String blockType, double speed,
                                     String sequence) {
        JSONObject msg = new JSONObject();
        msg.put("type", TYPE_PLAYER_BLOCK);
        msg.put("uuid", uuid.toString());
        msg.put("action", action);
        msg.put("blockType", blockType);
        msg.put("speed", speed);
        msg.put("sequence", sequence);
        msg.put("timestamp", System.currentTimeMillis());
        return msg.toJSONString();
    }

    @SuppressWarnings("unchecked")
    public static String playerAction(UUID uuid, String action, boolean state) {
        JSONObject msg = new JSONObject();
        msg.put("type", TYPE_PLAYER_ACTION);
        msg.put("uuid", uuid.toString());
        msg.put("action", action);
        msg.put("state", state);
        msg.put("timestamp", System.currentTimeMillis());
        return msg.toJSONString();
    }

    @SuppressWarnings("unchecked")
    public static String gameModeChange(UUID uuid, String oldMode, String newMode) {
        JSONObject msg = new JSONObject();
        msg.put("type", TYPE_GAME_MODE_CHANGE);
        msg.put("uuid", uuid.toString());
        msg.put("oldMode", oldMode);
        msg.put("newMode", newMode);
        msg.put("timestamp", System.currentTimeMillis());
        return msg.toJSONString();
    }

    @SuppressWarnings("unchecked")
    public static String actionExecuted(String actionId, UUID uuid, String action, boolean success, String message) {
        JSONObject msg = new JSONObject();
        msg.put("type", TYPE_ACTION_EXECUTED);
        msg.put("actionId", actionId);
        if (uuid != null) {
            msg.put("uuid", uuid.toString());
            msg.put("playerId", uuid.toString());
        }
        if (action != null) {
            msg.put("action", action);
        }
        msg.put("success", success);
        msg.put("result", success ? "success" : "failed");
        msg.put("message", message);
        msg.put("timestamp", System.currentTimeMillis());
        return msg.toJSONString();
    }

    @SuppressWarnings("unchecked")
    public static String heartbeat() {
        JSONObject msg = new JSONObject();
        msg.put("type", TYPE_HEARTBEAT);
        msg.put("timestamp", System.currentTimeMillis());
        return msg.toJSONString();
    }

    @SuppressWarnings("unchecked")
    public static String banExecuted(UUID uuid, String playerName, String reason, String duration, String source) {
        JSONObject msg = new JSONObject();
        msg.put("type", TYPE_BAN_EXECUTED);
        msg.put("uuid", uuid.toString());
        msg.put("name", playerName);
        msg.put("reason", reason);
        msg.put("duration", duration);
        msg.put("source", source);
        msg.put("timestamp", System.currentTimeMillis());
        return msg.toJSONString();
    }

    @SuppressWarnings("unchecked")
    public static String unbanExecuted(UUID uuid, String playerName, String source) {
        JSONObject msg = new JSONObject();
        msg.put("type", TYPE_UNBAN_EXECUTED);
        msg.put("uuid", uuid.toString());
        msg.put("name", playerName);
        msg.put("source", source);
        msg.put("timestamp", System.currentTimeMillis());
        return msg.toJSONString();
    }

    @SuppressWarnings("unchecked")
    public static JSONObject parseIncoming(String json) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            Object parsed = new JSONParser().parse(json);
            if (parsed instanceof JSONObject) {
                return (JSONObject) parsed;
            }
            return null;
        } catch (Exception e) {
            return null;
        }
    }

    public static String getString(JSONObject msg, String key) {
        Object val = msg.get(key);
        return val != null ? val.toString() : null;
    }

    public static double getDouble(JSONObject msg, String key) {
        Object val = msg.get(key);
        if (val instanceof Number) {
            return ((Number) val).doubleValue();
        }
        return 0.0;
    }

    public static int getInt(JSONObject msg, String key) {
        Object val = msg.get(key);
        if (val instanceof Number) {
            return ((Number) val).intValue();
        }
        return 0;
    }

    public static long getLong(JSONObject msg, String key) {
        Object val = msg.get(key);
        if (val instanceof Number) {
            return ((Number) val).longValue();
        }
        return 0L;
    }

    public static boolean getBoolean(JSONObject msg, String key) {
        Object val = msg.get(key);
        if (val instanceof Boolean) {
            return (Boolean) val;
        }
        return false;
    }
}
