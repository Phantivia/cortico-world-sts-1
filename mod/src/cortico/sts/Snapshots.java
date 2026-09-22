package cortico.sts;

import com.google.gson.*;
import com.megacrit.cardcrawl.cards.AbstractCard;
import com.megacrit.cardcrawl.actions.GameActionManager;
import com.megacrit.cardcrawl.core.AbstractCreature;
import com.megacrit.cardcrawl.core.CardCrawlGame;
import com.megacrit.cardcrawl.dungeons.AbstractDungeon;
import com.megacrit.cardcrawl.monsters.AbstractMonster;
import com.megacrit.cardcrawl.powers.AbstractPower;
import com.megacrit.cardcrawl.relics.RunicDome;
import communicationmod.*;
import java.util.*;

final class Snapshots {
    private static final Gson GSON = new Gson();
    private static final String SESSION = UUID.randomUUID().toString();
    private static String previous = "";
    private static long revision;

    static JsonObject read() {
        JsonObject raw = new JsonParser().parse(GameStateConverter.getCommunicationState()).getAsJsonObject();
        JsonObject result = new JsonObject();
        boolean inGame = CommandExecutor.isInDungeon();
        boolean ready = GameStateListener.isWaitingForCommand();
        JsonObject game = inGame ? raw.getAsJsonObject("game_state") : null;
        String screen = inGame ? game.get("screen_type").getAsString()
            : CardCrawlGame.mainMenuScreen == null ? "LOADING" : CardCrawlGame.mainMenuScreen.screen.name();
        if (inGame && screen.equals("NONE") && game.get("room_phase").getAsString().equals("COMBAT")) screen = "COMBAT";
        if (inGame) {
            ready &= !AbstractDungeon.isFadingOut && !AbstractDungeon.isFadingIn;
            if (screen.equals("COMBAT")) {
                ready &= GameActionManager.turn > 0 && !AbstractDungeon.player.endTurnQueued
                    && AbstractDungeon.actionManager.phase == GameActionManager.Phase.WAITING_ON_USER
                    && AbstractDungeon.actionManager.currentAction == null
                    && AbstractDungeon.actionManager.actions.isEmpty()
                    && AbstractDungeon.actionManager.preTurnActions.isEmpty()
                    && AbstractDungeon.actionManager.cardQueue.isEmpty();
                for (AbstractMonster monster : AbstractDungeon.getMonsters().monsters)
                    if (!monster.isDeadOrEscaped() && !monster.halfDead && monster.intent == AbstractMonster.Intent.DEBUG) ready = false;
            }
            game.remove("seed");
            game.remove("current_action");
            game.remove("action_phase");
            if (game.has("combat_state")) {
                JsonObject combat = game.getAsJsonObject("combat_state");
                combat.remove("limbo");
                JsonArray draw = combat.getAsJsonArray("draw_pile");
                ArrayList<JsonElement> sorted = new ArrayList<>();
                for (JsonElement card : draw) sorted.add(card);
                sorted.sort(Comparator.comparing(e -> e.getAsJsonObject().get("uuid").getAsString()));
                JsonArray unordered = new JsonArray();
                for (JsonElement card : sorted) unordered.add(card);
                combat.add("draw_pile", unordered);
                combat.addProperty("draw_pile_order", "unknown");
                int index = 0;
                for (JsonElement item : combat.getAsJsonArray("monsters")) {
                    JsonObject monster = item.getAsJsonObject();
                    for (String key : Arrays.asList("move_id", "move_base_damage", "last_move_id", "second_last_move_id")) monster.remove(key);
                    if (AbstractDungeon.player.hasRelic(RunicDome.ID)) {
                        monster.addProperty("intent", "UNKNOWN");
                        monster.remove("move_adjusted_damage");
                        monster.remove("move_hits");
                    }
                    monster.addProperty("index", index++);
                }
                combat.getAsJsonObject("player").addProperty("stance", AbstractDungeon.player.stance.ID);
            }
            Map<String, AbstractCard> cards = new HashMap<>();
            for (Iterable<AbstractCard> group : Arrays.asList(AbstractDungeon.player.masterDeck.group,
                AbstractDungeon.player.hand.group, AbstractDungeon.player.drawPile.group,
                AbstractDungeon.player.discardPile.group, AbstractDungeon.player.exhaustPile.group)) {
                for (AbstractCard card : group) cards.put(card.uuid.toString(), card);
            }
            // Only card-bearing screens are enriched; face-down event cards stay opaque.
            if (screen.equals("CARD_REWARD")) for (AbstractCard c : AbstractDungeon.cardRewardScreen.rewardGroup) cards.put(c.uuid.toString(), c);
            if (screen.equals("GRID")) for (AbstractCard c : ChoiceScreenUtils.getGridScreenCards()) cards.put(c.uuid.toString(), c);
            if (screen.equals("HAND_SELECT")) for (AbstractCard c : AbstractDungeon.handCardSelectScreen.selectedCards.group) cards.put(c.uuid.toString(), c);
            if (screen.equals("SHOP_SCREEN")) for (AbstractCard c : ChoiceScreenUtils.getShopScreenCards()) cards.put(c.uuid.toString(), c);
            enrichCards(game, cards, false);
            if (screen.equals("GRID") && AbstractDungeon.gridSelectScreen.forUpgrade) {
                JsonObject state = game.getAsJsonObject("screen_state");
                for (JsonElement entry : state.getAsJsonArray("cards")) {
                    JsonObject value = entry.getAsJsonObject();
                    AbstractCard source = cards.get(value.get("uuid").getAsString());
                    if (source.canUpgrade()) {
                        AbstractCard preview = source.makeStatEquivalentCopy();
                        preview.upgrade();
                        JsonObject upgraded = card(preview, false);
                        upgraded.remove("uuid");
                        value.add("upgrade", upgraded);
                    }
                }
                AbstractCard preview = AbstractDungeon.gridSelectScreen.upgradePreviewCard;
                if (AbstractDungeon.gridSelectScreen.confirmScreenUp && preview != null) {
                    JsonObject upgraded = card(preview, false);
                    upgraded.remove("uuid");
                    state.add("upgrade_preview", upgraded);
                }
            }
            enrichItems(game);
        }
        result.addProperty("ready", ready);
        result.addProperty("screen", screen);
        result.add("game", game == null ? JsonNull.INSTANCE : game);
        if (!ready) Actions.current.clear();
        result.add("actions", ready ? Actions.list() : new JsonArray());
        String fingerprint = GSON.toJson(result);
        if (!fingerprint.equals(previous)) { revision++; previous = fingerprint; }
        result.addProperty("revision", revision);
        result.addProperty("sessionId", SESSION);
        return result;
    }

    static String text(String value) {
        return value == null ? "" : value.replace(" NL ", "\n").replace("NL", "\n").replaceAll("#[rgbypw]", "").replace("~", "").replace("@", "");
    }

    static JsonObject card(AbstractCard c) {
        return card(c, AbstractDungeon.player.hand.group.contains(c));
    }

    private static JsonObject card(AbstractCard c, boolean modified) {
        int damage = modified && c.damage >= 0 ? c.damage : c.baseDamage;
        int block = modified && c.block >= 0 ? c.block : c.baseBlock;
        int magic = modified && c.magicNumber >= 0 ? c.magicNumber : c.baseMagicNumber;
        JsonObject o = new JsonObject();
        o.addProperty("uuid", c.uuid.toString()); o.addProperty("id", c.cardID); o.addProperty("name", c.name);
        o.addProperty("type", c.type.name());
        o.addProperty("cost", c.costForTurn); o.addProperty("target", c.target.name());
        o.addProperty("description", text(c.rawDescription.replace("!D!", Integer.toString(damage))
            .replace("!B!", Integer.toString(block)).replace("!M!", Integer.toString(magic))));
        if (damage >= 0) o.addProperty("damage", damage);
        if (block >= 0) o.addProperty("block", block);
        if (magic >= 0) o.addProperty("magic", magic);
        o.addProperty("exhausts", c.exhaust); o.addProperty("ethereal", c.isEthereal); o.addProperty("retains", c.retain || c.selfRetain);
        return o;
    }

    private static void enrichCards(JsonElement element, Map<String, AbstractCard> cards, boolean modified) {
        if (element.isJsonArray()) { for (JsonElement e : element.getAsJsonArray()) enrichCards(e, cards, modified); }
        if (!element.isJsonObject()) return;
        JsonObject o = element.getAsJsonObject();
        if (o.has("uuid") && cards.containsKey(o.get("uuid").getAsString())) {
            for (Map.Entry<String, JsonElement> entry : card(cards.get(o.get("uuid").getAsString()), modified).entrySet()) o.add(entry.getKey(), entry.getValue());
        }
        for (Map.Entry<String, JsonElement> entry : o.entrySet()) enrichCards(entry.getValue(), cards, modified || entry.getKey().equals("hand"));
    }

    private static void enrichItems(JsonObject game) {
        Map<String, String> descriptions = new HashMap<>();
        AbstractDungeon.player.relics.forEach(r -> descriptions.put(r.relicId, text(r.description)));
        AbstractDungeon.player.potions.forEach(p -> descriptions.put(p.ID, text(p.description)));
        if (ChoiceScreenUtils.getCurrentChoiceType() == ChoiceScreenUtils.ChoiceType.SHOP_SCREEN) {
            ChoiceScreenUtils.getShopScreenRelics().forEach(r -> descriptions.put(r.relic.relicId, text(r.relic.description)));
            ChoiceScreenUtils.getShopScreenPotions().forEach(p -> descriptions.put(p.potion.ID, text(p.potion.description)));
        }
        if (ChoiceScreenUtils.getCurrentChoiceType() == ChoiceScreenUtils.ChoiceType.BOSS_REWARD)
            AbstractDungeon.bossRelicScreen.relics.forEach(r -> descriptions.put(r.relicId, text(r.description)));
        if (ChoiceScreenUtils.getCurrentChoiceType() == ChoiceScreenUtils.ChoiceType.COMBAT_REWARD)
            AbstractDungeon.combatRewardScreen.rewards.forEach(r -> {
                if (r.relic != null) descriptions.put(r.relic.relicId, text(r.relic.description));
                if (r.potion != null) descriptions.put(r.potion.ID, text(r.potion.description));
            });
        describe(game, descriptions);
        if (game.has("combat_state")) {
            JsonObject combat = game.getAsJsonObject("combat_state");
            powers(combat.getAsJsonObject("player"), AbstractDungeon.player);
            int i = 0;
            for (AbstractMonster monster : AbstractDungeon.getMonsters().monsters)
                powers(combat.getAsJsonArray("monsters").get(i++).getAsJsonObject(), monster);
        }
    }

    private static void describe(JsonElement element, Map<String, String> descriptions) {
        if (element.isJsonArray()) for (JsonElement e : element.getAsJsonArray()) describe(e, descriptions);
        if (!element.isJsonObject()) return;
        JsonObject o = element.getAsJsonObject();
        if (o.has("id") && descriptions.containsKey(o.get("id").getAsString())) o.addProperty("description", descriptions.get(o.get("id").getAsString()));
        for (Map.Entry<String, JsonElement> entry : o.entrySet()) describe(entry.getValue(), descriptions);
    }

    private static void powers(JsonObject creature, AbstractCreature source) {
        JsonArray visible = new JsonArray();
        for (AbstractPower power : source.powers) {
            JsonObject p = new JsonObject(); p.addProperty("id", power.ID); p.addProperty("name", power.name);
            p.addProperty("amount", power.amount); p.addProperty("description", text(power.description)); visible.add(p);
        }
        creature.add("powers", visible);
    }
}
