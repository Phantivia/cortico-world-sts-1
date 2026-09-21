package cortico.sts;

import com.badlogic.gdx.Gdx;
import com.badlogic.gdx.graphics.*;
import com.badlogic.gdx.graphics.g2d.SpriteBatch;
import com.google.gson.*;
import com.megacrit.cardcrawl.core.Settings;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.*;

final class Cursor {
    private static Texture arrow, companion;
    private static JsonObject art;
    private static float x = 400, y = 400, fromX, fromY;
    private static long segmentAt, stateAt;
    private static int segment, duration;
    private static List<float[]> path = Collections.emptyList();
    private static String state = "idle";
    private static boolean visible;

    static void move(List<float[]> points, int durationMs) {
        visible = true; path = new ArrayList<>(points); segment = 0; duration = durationMs;
        segmentAt = System.nanoTime(); fromX = x; fromY = y; setState("moving");
    }
    static void cancel() { path = Collections.emptyList(); setState("idle"); }
    static void press() { setState("pressed"); }
    private static void setState(String next) { state = next; stateAt = System.nanoTime(); }
    static boolean update() {
        if (segment >= path.size()) return true;
        float[] to = path.get(segment);
        float t = duration == 0 ? 1 : Math.min(1, (System.nanoTime() - segmentAt) / (duration * 1_000_000f));
        float ease = t * t * (3 - 2 * t);
        x = fromX + (to[0] - fromX) * ease; y = fromY + (to[1] - fromY) * ease;
        if (t == 1) { segment++; segmentAt = System.nanoTime(); fromX = x; fromY = y; }
        return segment >= path.size();
    }
    static void render(SpriteBatch sb) {
        if (!visible) return;
        if (arrow == null) initialize();
        long ageMs = (System.nanoTime() - stateAt) / 1_000_000;
        if (state.equals("pressed") && ageMs > 150) setState("released");
        if (state.equals("released") && ageMs > 280) setState("idle");
        float scale = Math.max(1, Settings.scale * 1.5f);
        float flipX = x > Settings.WIDTH - 70 * scale ? -1 : 1;
        float flipY = y < 70 * scale ? -1 : 1;
        sb.setColor(Color.WHITE);
        sb.draw(arrow, x, y - 31 * scale * flipY, 23 * scale * flipX, 31 * scale * flipY);
        JsonObject animation = art.getAsJsonObject("animations").getAsJsonObject(state);
        JsonArray frames = animation.getAsJsonArray("frames");
        int total = 0; for (JsonElement frame : frames) total += frame.getAsJsonArray().get(2).getAsInt();
        long offset = animation.get("loops").getAsBoolean() ? ageMs % total : Math.min(ageMs, total - 1);
        int dx = 0, dy = 0;
        for (JsonElement value : frames) {
            JsonArray frame = value.getAsJsonArray();
            if (offset < frame.get(2).getAsInt()) { dx = frame.get(0).getAsInt(); dy = frame.get(1).getAsInt(); break; }
            offset -= frame.get(2).getAsInt();
        }
        sb.draw(companion, x + (19 + dx) * scale * flipX, y - (45 + dy) * scale * flipY,
            26 * scale * flipX, 26 * scale * flipY);
        if (state.equals("pressed")) {
            sb.setColor(Color.CYAN);
            for (int i = 0; i < 24; i++) {
                double a = Math.PI * 2 * i / 24;
                sb.draw(com.megacrit.cardcrawl.helpers.ImageMaster.WHITE_SQUARE_IMG,
                    x + (float)Math.cos(a) * 12 * scale, y + (float)Math.sin(a) * 12 * scale, 2 * scale, 2 * scale);
            }
            sb.setColor(Color.WHITE);
        }
    }
    private static void initialize() {
        art = new JsonParser().parse(new InputStreamReader(Cursor.class.getResourceAsStream("/cursor-companion.json"), StandardCharsets.UTF_8)).getAsJsonObject();
        Pixmap p = new Pixmap(23, 31, Pixmap.Format.RGBA8888);
        p.setColor(Color.BLACK);
        p.fillTriangle(0, 0, 0, 23, 21, 15); p.fillTriangle(4, 14, 11, 30, 18, 25);
        p.setColor(Color.WHITE);
        p.fillTriangle(2, 4, 2, 19, 16, 13); p.fillTriangle(7, 14, 12, 27, 15, 24);
        p.setColor(Color.CYAN); p.drawLine(3, 7, 4, 15);
        arrow = new Texture(p); p.dispose();
        Pixmap sprite = new Pixmap(26, 26, Pixmap.Format.RGBA8888);
        JsonArray rows = art.getAsJsonArray("pixels"), palette = art.getAsJsonArray("palette");
        sprite.setColor(Color.BLACK);
        for (int row = 0; row < 24; row++) for (int col = 0; col < 24; col++) {
            if (rows.get(row).getAsString().charAt(col) != '.') sprite.fillRectangle(col, row, 3, 3);
        }
        for (int row = 0; row < 24; row++) for (int col = 0; col < 24; col++) {
            char pixel = rows.get(row).getAsString().charAt(col);
            if (pixel != '.') { sprite.setColor(Color.valueOf(palette.get(pixel - '0').getAsString().substring(1))); sprite.drawPixel(col + 1, row + 1); }
        }
        companion = new Texture(sprite); sprite.dispose();
        arrow.setFilter(Texture.TextureFilter.Nearest, Texture.TextureFilter.Nearest);
        companion.setFilter(Texture.TextureFilter.Nearest, Texture.TextureFilter.Nearest);
    }
}
