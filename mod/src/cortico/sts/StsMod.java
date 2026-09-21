package cortico.sts;

import basemod.BaseMod;
import basemod.interfaces.*;
import com.badlogic.gdx.Gdx;
import com.badlogic.gdx.graphics.g2d.SpriteBatch;
import com.badlogic.gdx.utils.ScreenUtils;
import com.evacipated.cardcrawl.modthespire.lib.*;
import com.google.gson.*;
import com.megacrit.cardcrawl.core.Settings;
import com.megacrit.cardcrawl.helpers.input.InputHelper;
import communicationmod.*;
import java.awt.image.BufferedImage;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import javax.imageio.ImageIO;

@SpireInitializer
public final class StsMod implements PreUpdateSubscriber, PostUpdateSubscriber, PostRenderSubscriber {
    private final BlockingQueue<Request> incoming = new ArrayBlockingQueue<>(32);
    private final Set<String> seen = new LinkedHashSet<>();
    private final String token = System.getenv("CORTICO_STS_TOKEN");
    private volatile Client client;
    private JsonObject snapshot;
    private Pending pending;
    private Request capture;
    private long lastPollAt, lastPublishedRevision = -1;
    private static int clickFrames;
    private static boolean rightClick;
    private static float clickX, clickY;

    public static void initialize() { new StsMod(); }
    public StsMod() {
        BaseMod.subscribe(this);
        if (token == null || token.length() < 24) {
            System.err.println("[CorticoSts] Sidecar disabled: CORTICO_STS_TOKEN needs at least 24 characters"); return;
        }
        Thread server = new Thread(this::listen, "cortico-sts-sidecar"); server.setDaemon(true); server.start();
    }
    private void listen() {
        int port = Integer.parseInt(System.getenv().getOrDefault("CORTICO_STS_PORT", "27831"));
        try (ServerSocket server = new ServerSocket(port, 1, InetAddress.getByName("127.0.0.1"))) {
            while (true) {
                Socket socket = server.accept(); socket.setTcpNoDelay(true); socket.setSoTimeout(5000);
                Client c = new Client(socket);
                Thread reader = new Thread(() -> read(c), "cortico-sts-reader"); reader.setDaemon(true); reader.start();
            }
        } catch (Exception e) { System.err.println("[CorticoSts] " + e); }
    }
    private void read(Client c) {
        try {
            JsonObject hello = readLine(c.reader);
            if (hello == null || !"hello".equals(string(hello, "type")) || number(hello, "protocol", 0) != 1
                || !MessageDigest.isEqual(token.getBytes(StandardCharsets.UTF_8), string(hello, "token").getBytes(StandardCharsets.UTF_8))) return;
            synchronized (this) {
                if (client != null && !client.socket.isClosed()) return;
                client = c;
            }
            c.socket.setSoTimeout(0); enqueue(new Request(c, hello));
            JsonObject request;
            while ((request = readLine(c.reader)) != null) {
                if (number(request, "protocol", 0) != 1) throw new IOException("Protocol mismatch");
                enqueue(new Request(c, request));
            }
        } catch (Exception e) { System.err.println("[CorticoSts] connection: " + e.getClass().getSimpleName()); }
        finally { c.close(); }
    }
    private void enqueue(Request req) throws IOException {
        if (req.id.isEmpty() || req.id.length() > 128 || !incoming.offer(req)) throw new IOException("Invalid or excessive requests");
    }
    private static JsonObject readLine(BufferedReader reader) throws IOException {
        StringBuilder line = new StringBuilder(); int value;
        while ((value = reader.read()) != -1 && value != '\n') {
            if (line.length() >= 65536) throw new IOException("Request exceeds 64 KiB");
            line.append((char)value);
        }
        if (value == -1 && line.length() == 0) return null;
        return new JsonParser().parse(line.toString()).getAsJsonObject();
    }
    private static String string(JsonObject o, String key) { return o.has(key) ? o.get(key).getAsString() : ""; }
    private static int number(JsonObject o, String key, int fallback) { return o.has(key) ? o.get(key).getAsInt() : fallback; }

    public void receivePreUpdate() {
        if (client == null) return;
        try {
            if (pending != null && !pending.submitted) {
                if (pending.req.client.socket.isClosed()) { pending = null; Cursor.cancel(); }
                else if (Cursor.update()) {
                    snapshot = Snapshots.read();
                    if (!matches(pending.req.body, snapshot)) finish("rejected", "Snapshot changed before input");
                    else {
                        try {
                            pending.action.execute(); pending.submitted = true; pending.submittedAt = System.nanoTime(); Cursor.press();
                        } catch (Exception e) { finish("unknown", "Game input failed; observe before another action: " + e); }
                    }
                }
            }
            Request req = incoming.poll();
            if (req != null && !req.client.socket.isClosed()) handle(req);
        } catch (Exception e) {
            if (pending != null) finish("unknown", e.toString());
            System.err.println("[CorticoSts] update: " + e);
        }
    }

    private void handle(Request req) {
        try {
            snapshot = Snapshots.read();
            if (!seen.add(req.id)) { error(req, "Duplicate request ID; no replay"); return; }
            if (seen.size() > 4096) seen.remove(seen.iterator().next());
            switch (string(req.body, "type")) {
                case "hello": reply(req, "hello", "snapshot", snapshot); lastPublishedRevision = revision(); break;
                case "observe": reply(req, "snapshot", "snapshot", snapshot); break;
                case "capture":
                    if (capture != null) error(req, "Capture in flight"); else capture = req;
                    break;
                case "cancel":
                    if (pending != null && !pending.submitted && pending.req.id.equals(string(req.body, "requestId"))) finish("rejected", "Cancelled before input");
                    reply(req, "snapshot", "snapshot", snapshot); break;
                case "do": case "fallback": begin(req); break;
                default: error(req, "Unknown request type");
            }
        } catch (Exception e) { error(req, e.toString()); }
    }

    private void begin(Request req) {
        if (pending != null) { reject(req, "Another action is in flight"); return; }
        if (!matches(req.body, snapshot) || !snapshot.get("ready").getAsBoolean()) { reject(req, "Stale snapshot or game not ready"); return; }
        Actions.Action action;
        if (string(req.body, "type").equals("fallback")) action = fallback(req.body);
        else action = Actions.current.get(string(req.body, "actionId"));
        if (action == null) { reject(req, "Action is not available in this snapshot"); return; }
        int duration = number(req.body, "cursorDurationMs", 240), timeout = number(req.body, "timeoutMs", 30000);
        if (duration < 0 || duration > 2000 || timeout < 1000 || timeout > 120000) { reject(req, "Invalid action timing"); return; }
        pending = new Pending(req, action, timeout);
        Cursor.move(action.points, duration);
    }

    private Actions.Action fallback(JsonObject body) {
        if (!CommandExecutor.isInDungeon()) throw new IllegalArgumentException("Fallback input is only available in a run");
        if (string(body, "kind").equals("click")) {
            int x = number(body, "x", -1), y = number(body, "y", -1);
            String button = string(body, "button");
            if (x < 0 || x > 1920 || y < 0 || y > 1080 || !Arrays.asList("left", "right").contains(button)) throw new IllegalArgumentException("Invalid game coordinates/button");
            Actions.Action action = new Actions.Action("fallback:click", "click", "Game click", null);
            final float px = x / 1920f * Settings.WIDTH, py = Settings.HEIGHT - y / 1080f * Settings.HEIGHT;
            action.points.add(new float[] {px, py});
            action.custom = () -> { clickX = px; clickY = py; rightClick = button.equals("right"); clickFrames = 2; GameStateListener.setTimeout(10); };
            return action;
        }
        String key = string(body, "key").toLowerCase(Locale.ROOT);
        if (!Arrays.asList("confirm", "cancel", "map", "deck", "draw_pile", "discard_pile", "exhaust_pile", "end_turn", "up", "down", "left", "right", "drop_card", "card_1", "card_2", "card_3", "card_4", "card_5", "card_6", "card_7", "card_8", "card_9", "card_10").contains(key)) throw new IllegalArgumentException("Invalid game key");
        return new Actions.Action("fallback:key", "key", key, "key " + key + " 10");
    }

    public void receivePostUpdate() {
        if (client == null || client.socket.isClosed()) return;
        long now = System.nanoTime();
        if (now - lastPollAt < 100_000_000L) return;
        lastPollAt = now;
        try {
            snapshot = Snapshots.read();
            if (pending != null) {
                if ((now - pending.startedAt) / 1_000_000 > pending.timeoutMs) {
                    finish(pending.submitted ? "unknown" : "rejected", "Action deadline reached; observe before another action");
                } else if (pending.submitted && now - pending.submittedAt > 100_000_000L && snapshot.get("ready").getAsBoolean()) {
                    finish("executed", null);
                }
            } else if (revision() != lastPublishedRevision) {
                JsonObject event = envelope("snapshot", null); event.add("snapshot", snapshot); client.send(event); lastPublishedRevision = revision();
            }
        } catch (Exception e) {
            if (pending != null) finish("unknown", "Snapshot failed: " + e);
            System.err.println("[CorticoSts] snapshot: " + e);
        }
    }

    public void receivePostRender(SpriteBatch sb) {
        Cursor.render(sb);
        if (capture == null) return;
        Request req = capture; capture = null;
        try {
            sb.flush();
            int width = Gdx.graphics.getWidth(), height = Gdx.graphics.getHeight();
            byte[] rgba = ScreenUtils.getFrameBufferPixels(0, 0, width, height, true);
            BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
            for (int y = 0; y < height; y++) for (int x = 0; x < width; x++) {
                int i = (y * width + x) * 4;
                image.setRGB(x, y, ((rgba[i] & 255) << 16) | ((rgba[i + 1] & 255) << 8) | (rgba[i + 2] & 255));
            }
            ByteArrayOutputStream bytes = new ByteArrayOutputStream(); ImageIO.write(image, "png", bytes);
            reply(req, "frame", "base64", new JsonPrimitive(Base64.getEncoder().encodeToString(bytes.toByteArray())));
        } catch (Exception e) { error(req, e.toString()); }
    }

    private long revision() { return snapshot.get("revision").getAsLong(); }
    private boolean matches(JsonObject req, JsonObject state) {
        return string(req, "sessionId").equals(string(state, "sessionId")) && req.has("revision") && req.get("revision").getAsLong() == state.get("revision").getAsLong();
    }
    private void reject(Request req, String reason) {
        JsonObject receipt = new JsonObject(); receipt.addProperty("outcome", "rejected"); receipt.addProperty("reason", reason);
        receipt.add("snapshot", snapshot); reply(req, "result", "receipt", receipt);
    }
    private void finish(String outcome, String reason) {
        Pending done = pending; pending = null; Cursor.cancel();
        JsonObject receipt = new JsonObject(); receipt.addProperty("outcome", outcome); receipt.addProperty("actionId", done.action.id);
        if (reason != null) receipt.addProperty("reason", reason);
        receipt.add("snapshot", snapshot); reply(done.req, "result", "receipt", receipt); lastPublishedRevision = revision();
    }
    private static JsonObject envelope(String type, String id) {
        JsonObject o = new JsonObject(); o.addProperty("protocol", 1); o.addProperty("type", type); if (id != null) o.addProperty("id", id); return o;
    }
    private void reply(Request req, String type, String key, JsonElement value) {
        JsonObject o = envelope(type, req.id); o.add(key, value); req.client.send(o);
    }
    private void error(Request req, String reason) { reply(req, "error", "reason", new JsonPrimitive(reason)); }
    private static final class Request {
        final Client client; final JsonObject body; final String id;
        Request(Client client, JsonObject body) { this.client = client; this.body = body; this.id = string(body, "id"); }
    }
    private static final class Pending {
        final Request req; final Actions.Action action; final int timeoutMs; final long startedAt = System.nanoTime();
        boolean submitted; long submittedAt;
        Pending(Request req, Actions.Action action, int timeoutMs) { this.req = req; this.action = action; this.timeoutMs = timeoutMs; }
    }
    private static final class Client {
        final Socket socket; final BufferedReader reader;
        final BlockingQueue<String> out = new ArrayBlockingQueue<>(32);
        Client(Socket socket) throws IOException {
            this.socket = socket; reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
            Thread writer = new Thread(() -> {
                try {
                    BufferedWriter output = new BufferedWriter(new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8));
                    while (!socket.isClosed()) { String line = out.poll(1, TimeUnit.SECONDS); if (line != null) { output.write(line); output.newLine(); output.flush(); } }
                } catch (Exception e) { close(); }
            }, "cortico-sts-writer"); writer.setDaemon(true); writer.start();
        }
        void send(JsonObject value) { if (!socket.isClosed() && !out.offer(value.toString())) close(); }
        void close() { try { socket.close(); } catch (IOException ignored) {} }
    }

    @SpirePatch(clz = InputHelper.class, method = "updateFirst")
    public static class LocalClick {
        @SpirePostfixPatch public static void after() {
            if (clickFrames == 0) return;
            InputHelper.mX = (int)clickX; InputHelper.mY = (int)clickY;
            if (rightClick) { InputHelper.justClickedRight = clickFrames == 2; InputHelper.justReleasedClickRight = clickFrames == 1; }
            else { InputHelper.justClickedLeft = clickFrames == 2; InputHelper.justReleasedClickLeft = clickFrames == 1; }
            clickFrames--;
        }
    }
}
