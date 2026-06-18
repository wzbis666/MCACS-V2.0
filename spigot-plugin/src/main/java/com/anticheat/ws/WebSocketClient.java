package com.anticheat.ws;

import java.net.URI;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.bukkit.Bukkit;
import com.anticheat.AntiCheatPlugin;
import org.json.simple.JSONObject;

public class WebSocketClient {

    private final String serverUri;
    private org.java_websocket.client.WebSocketClient client;
    private final ActionCallback callback;
    private final ScheduledExecutorService scheduler;
    private ScheduledFuture<?> heartbeatTask;
    private ScheduledFuture<?> reconnectTask;
    private final AtomicInteger reconnectDelay = new AtomicInteger(1);
    private volatile boolean intentionalClose = false;
    private volatile boolean connected = false;
    /** 消息缓冲队列：断连时缓存消息，重连后重发 */
    private final BlockingQueue<String> sendBuffer = new LinkedBlockingQueue<>(1000);

    public interface ActionCallback {
        void onAction(JSONObject message);
        void onConnected();
        void onDisconnected();
    }

    public WebSocketClient(String uri, ActionCallback callback) {
        this.serverUri = uri;
        this.callback = callback;
        this.scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "ACS-WebSocket-Scheduler");
            t.setDaemon(true);
            return t;
        });
    }

    public void connect() {
        intentionalClose = false;
        try {
            URI uri = new URI(serverUri);
            client = new org.java_websocket.client.WebSocketClient(uri) {
                @Override
                public void onOpen(org.java_websocket.handshake.ServerHandshake handshake) {
                    connected = true;
                    reconnectDelay.set(1);
                    startHeartbeat();
                    flushBuffer();
                    callback.onConnected();
                }

                @Override
                public void onMessage(String message) {
                    JSONObject parsed = MessageProtocol.parseIncoming(message);
                    if (parsed != null) {
                        String type = MessageProtocol.getString(parsed, "type");
                        if (!MessageProtocol.TYPE_HEARTBEAT.equals(type)) {
                            callback.onAction(parsed);
                        }
                    }
                }

                @Override
                public void onClose(int code, String reason, boolean remote) {
                    connected = false;
                    stopHeartbeat();
                    callback.onDisconnected();
                    if (!intentionalClose) {
                        scheduleReconnect();
                    }
                }

                @Override
                public void onError(Exception ex) {
                    Bukkit.getLogger().warning("[AntiCheat] WebSocket error: " + ex.getMessage());
                }
            };
            client.setConnectionLostTimeout(60);
            client.connect();
        } catch (Exception e) {
            Bukkit.getLogger().warning("[AntiCheat] WebSocket connection failed: " + e.getMessage());
            scheduleReconnect();
        }
    }

    public void disconnect() {
        intentionalClose = true;
        stopHeartbeat();
        cancelReconnect();
        if (client != null) {
            try {
                client.close();
            } catch (Exception ignored) {}
        }
        connected = false;
    }

    public void send(String message) {
        if (client != null && connected && client.isOpen()) {
            try {
                client.send(message);
            } catch (Exception e) {
                Bukkit.getLogger().warning("[AntiCheat] WebSocket send failed: " + e.getMessage());
                bufferMessage(message);
            }
        } else {
            bufferMessage(message);
        }
    }

    private void bufferMessage(String message) {
        if (!sendBuffer.offer(message)) {
            sendBuffer.poll(); // 丢弃最旧的消息
            sendBuffer.offer(message);
        }
    }

    private void flushBuffer() {
        while (!sendBuffer.isEmpty()) {
            try {
                String msg = sendBuffer.poll();
                if (msg != null && client != null && client.isOpen()) {
                    client.send(msg);
                }
            } catch (Exception e) {
                Bukkit.getLogger().warning("[AntiCheat] Buffer flush send failed: " + e.getMessage());
                break; // 发送失败，停止刷新
            }
        }
        if (!sendBuffer.isEmpty()) {
            Bukkit.getLogger().info("[AntiCheat] Buffer remaining: " + sendBuffer.size() + " messages");
        }
    }

    public boolean isConnected() {
        return connected && client != null && client.isOpen();
    }

    private void startHeartbeat() {
        stopHeartbeat();
        heartbeatTask = scheduler.scheduleAtFixedRate(() -> {
            if (isConnected()) {
                double tps = AntiCheatPlugin.getServerTPS();
                send(MessageProtocol.heartbeat(tps));
            }
        }, 30, 30, TimeUnit.SECONDS);
    }

    private void stopHeartbeat() {
        if (heartbeatTask != null) {
            heartbeatTask.cancel(false);
            heartbeatTask = null;
        }
    }

    private void scheduleReconnect() {
        cancelReconnect();
        int delay = reconnectDelay.get();
        Bukkit.getLogger().info("[AntiCheat] Reconnecting in " + delay + "s...");
        reconnectTask = scheduler.schedule(() -> {
            Bukkit.getLogger().info("[AntiCheat] Attempting WebSocket reconnect...");
            connect();
        }, delay, TimeUnit.SECONDS);
        int next = Math.min(delay * 2, 30);
        reconnectDelay.set(next);
    }

    private void cancelReconnect() {
        if (reconnectTask != null) {
            reconnectTask.cancel(false);
            reconnectTask = null;
        }
    }

    public void shutdown() {
        disconnect();
        scheduler.shutdown();
        try {
            if (!scheduler.awaitTermination(5, TimeUnit.SECONDS)) {
                scheduler.shutdownNow();
            }
        } catch (InterruptedException e) {
            scheduler.shutdownNow();
            Thread.currentThread().interrupt();
        }
    }
}
