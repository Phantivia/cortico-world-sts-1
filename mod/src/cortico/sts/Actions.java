package cortico.sts;

import basemod.ReflectionHacks;
import com.google.gson.*;
import com.megacrit.cardcrawl.cards.AbstractCard;
import com.megacrit.cardcrawl.characters.AbstractPlayer;
import com.megacrit.cardcrawl.core.*;
import com.megacrit.cardcrawl.dungeons.AbstractDungeon;
import com.megacrit.cardcrawl.helpers.Hitbox;
import com.megacrit.cardcrawl.monsters.AbstractMonster;
import com.megacrit.cardcrawl.potions.*;
import com.megacrit.cardcrawl.rooms.*;
import com.megacrit.cardcrawl.screens.charSelect.CharacterOption;
import com.megacrit.cardcrawl.screens.mainMenu.*;
import com.megacrit.cardcrawl.shop.*;
import com.megacrit.cardcrawl.ui.campfire.AbstractCampfireOption;
import communicationmod.*;
import java.util.*;

final class Actions {
    static final Map<String, Action> current = new LinkedHashMap<>();
    static final class Action {
        final String id, kind, label, command;
        final ArrayList<float[]> points = new ArrayList<>();
        JsonObject details;
        Runnable custom;
        Action(String id, String kind, String label, String command) {
            this.id = id; this.kind = kind; this.label = label; this.command = command;
        }
        Action at(Hitbox hb) { if (hb != null) points.add(new float[] {hb.cX, hb.cY}); return this; }
        JsonObject json() {
            JsonObject o = new JsonObject(); o.addProperty("id", id); o.addProperty("kind", kind); o.addProperty("label", label);
            if (details != null) o.add("details", details); return o;
        }
        void execute() throws InvalidCommandException {
            if (custom != null) { custom.run(); GameStateListener.registerStateChange(); }
            else if (CommandExecutor.executeCommand(command)) GameStateListener.registerCommandExecution();
        }
    }
    static Action add(String id, String kind, String label, String command) {
        Action a = new Action(id, kind, label, command); current.put(id, a); return a;
    }

    static JsonArray list() {
        current.clear();
        if (!GameStateListener.isWaitingForCommand()) return new JsonArray();
        if (!CommandExecutor.isInDungeon()) menu();
        else dungeon();
        JsonArray list = new JsonArray(); for (Action a : current.values()) list.add(a.json()); return list;
    }

    private static void menu() {
        MainMenuScreen menu = CardCrawlGame.mainMenuScreen;
        if (menu == null || menu.isFadingOut || menu.screen != MainMenuScreen.CurScreen.MAIN_MENU) return;
        boolean hasSave = false;
        for (MenuButton button : menu.buttons) if (button.result == MenuButton.ClickResult.RESUME_GAME) {
            Action a = add("continue", "continue", "继续存档", null).at(button.hb);
            a.custom = button::buttonEffect; hasSave = true;
        }
        if (hasSave) return;
        for (CharacterOption option : menu.charSelectScreen.options) {
            if (option.locked) continue;
            AbstractPlayer p = option.c;
            int max = Math.min(20, Math.max(0, p.getPrefs().getInteger("ASCENSION_LEVEL", 0)));
            for (int level = 0; level <= max; level++) {
                add("start:" + p.chosenClass.name() + ":" + level, "start",
                    p.getLocalizedCharacterName() + " · 进阶 " + level, "start " + p.chosenClass.name() + " " + level);
            }
        }
    }

    private static void dungeon() {
        List<String> commands = CommandExecutor.getAvailableCommands();
        if (commands.contains("play")) {
            int i = 0;
            for (AbstractCard card : AbstractDungeon.player.hand.group) {
                int slot = ++i;
                boolean targeted = card.target == AbstractCard.CardTarget.ENEMY || card.target == AbstractCard.CardTarget.SELF_AND_ENEMY;
                if (targeted) {
                    int target = 0;
                    for (AbstractMonster monster : AbstractDungeon.getMonsters().monsters) {
                        if (!monster.isDeadOrEscaped() && !monster.halfDead && card.canUse(AbstractDungeon.player, monster)) {
                            Action a = add("play:" + card.uuid + ":" + target, "play", card.name + " → " + monster.name + " [" + target + "]", "play " + slot + " " + target).at(card.hb).at(monster.hb);
                            a.details = Snapshots.card(card);
                        }
                        target++;
                    }
                } else if (card.canUse(AbstractDungeon.player, null)) {
                    Action a = add("play:" + card.uuid, "play", card.name, "play " + slot).at(card.hb);
                    a.details = Snapshots.card(card);
                    a.points.add(new float[] {Settings.WIDTH * .5f, Settings.HEIGHT * .55f});
                }
            }
        }
        if (commands.contains("end")) add("end_turn", "end_turn", "结束回合", "end").at(ReflectionHacks.getPrivate(AbstractDungeon.overlayMenu.endTurnButton, com.megacrit.cardcrawl.ui.buttons.EndTurnButton.class, "hb"));
        if (commands.contains("potion")) potions();
        if (commands.contains("choose")) choices();
        if (CommandExecutor.isConfirmCommandAvailable()) add("confirm", "confirm", ChoiceScreenUtils.getConfirmButtonText(), "confirm").at(confirmHitbox());
        if (CommandExecutor.isCancelCommandAvailable()) add("cancel", "cancel", ChoiceScreenUtils.getCancelButtonText(), "cancel").at(AbstractDungeon.overlayMenu.cancelButton.hb);
        String screen = AbstractDungeon.screen.name();
        if (Arrays.asList("MASTER_DECK_VIEW", "DRAW_PILE_VIEW", "DISCARD_VIEW", "EXHAUST_VIEW").contains(screen)) {
            Action a = add("close_view", "close_view", "关闭查看", null).at(AbstractDungeon.overlayMenu.cancelButton.hb);
            a.custom = AbstractDungeon::closeCurrentScreen;
        } else if (!AbstractDungeon.isScreenUp) {
            for (String view : Arrays.asList("map", "deck", "draw_pile", "discard_pile", "exhaust_pile")) {
                add("view:" + view, "view", "查看 " + view, "key " + view + " 8");
            }
        }
    }

    private static Hitbox confirmHitbox() {
        switch (ChoiceScreenUtils.getCurrentChoiceType()) {
            case HAND_SELECT: return AbstractDungeon.handCardSelectScreen.button.hb;
            case GRID: return AbstractDungeon.gridSelectScreen.confirmButton.hb;
            default: return ReflectionHacks.getPrivate(AbstractDungeon.overlayMenu.proceedButton, com.megacrit.cardcrawl.ui.buttons.ProceedButton.class, "hb");
        }
    }

    private static void potions() {
        int i = 0;
        for (AbstractPotion potion : AbstractDungeon.player.potions) {
            int slot = i++;
            if (potion instanceof PotionSlot) continue;
            if (potion.canDiscard()) add("discard_potion:" + slot, "discard_potion", "丢弃 " + potion.name, "potion discard " + slot).at(potion.hb);
            if (!potion.canUse()) continue;
            if (potion.targetRequired) {
                int target = 0;
                for (AbstractMonster monster : AbstractDungeon.getMonsters().monsters) {
                    if (!monster.isDeadOrEscaped() && !monster.halfDead) add("use_potion:" + slot + ":" + target, "use_potion", potion.name + " → " + monster.name + " [" + target + "]", "potion use " + slot + " " + target).at(potion.hb).at(monster.hb);
                    target++;
                }
            } else add("use_potion:" + slot, "use_potion", "使用 " + potion.name, "potion use " + slot).at(potion.hb);
        }
    }

    private static void choices() {
        ChoiceScreenUtils.ChoiceType type = ChoiceScreenUtils.getCurrentChoiceType();
        List<String> labels = ChoiceScreenUtils.getCurrentChoiceList();
        for (int i = 0; i < labels.size(); i++) {
            String kind;
            switch (type) {
                case MAP: kind = "map"; break;
                case EVENT: kind = "event"; break;
                case CHEST: kind = "chest"; break;
                case REST: kind = "rest"; break;
                case SHOP_ROOM: kind = "shop"; break;
                case SHOP_SCREEN: kind = labels.get(i).equals("purge") ? "purge" : "buy"; break;
                case COMBAT_REWARD: kind = "reward"; break;
                case CARD_REWARD: kind = "card_reward"; break;
                case BOSS_REWARD: kind = "boss_relic"; break;
                default: kind = "select";
            }
            Action a = add("choose:" + type.name() + ":" + i, kind, labels.get(i), "choose " + i);
            choiceTarget(a, type, i);
        }
    }

    @SuppressWarnings("unchecked")
    private static void choiceTarget(Action a, ChoiceScreenUtils.ChoiceType type, int i) {
        switch (type) {
            case CARD_REWARD:
                if (i < AbstractDungeon.cardRewardScreen.rewardGroup.size()) {
                    AbstractCard card = AbstractDungeon.cardRewardScreen.rewardGroup.get(i); a.at(card.hb); a.details = Snapshots.card(card);
                }
                break;
            case GRID: { AbstractCard c = ChoiceScreenUtils.getGridScreenCards().get(i); a.at(c.hb); a.details = Snapshots.card(c); break; }
            case HAND_SELECT: { AbstractCard c = AbstractDungeon.player.hand.group.get(i); a.at(c.hb); a.details = Snapshots.card(c); break; }
            case BOSS_REWARD: a.at(AbstractDungeon.bossRelicScreen.relics.get(i).hb); break;
            case COMBAT_REWARD: a.at(AbstractDungeon.combatRewardScreen.rewards.get(i).hb); break;
            case EVENT:
                if (i < ChoiceScreenUtils.getActiveEventButtons().size()) {
                    a.at(ChoiceScreenUtils.getActiveEventButtons().get(i).hb);
                    a.details = new JsonObject(); a.details.addProperty("text", Snapshots.text(ChoiceScreenUtils.getActiveEventButtons().get(i).msg));
                }
                break;
            case MAP:
                if (!ChoiceScreenUtils.bossNodeAvailable()) {
                    com.megacrit.cardcrawl.map.MapRoomNode node = ChoiceScreenUtils.getMapScreenNodeChoices().get(i);
                    a.at(node.hb); a.details = new JsonObject();
                    a.details.addProperty("x", node.x); a.details.addProperty("y", node.y); a.details.addProperty("symbol", node.getRoomSymbol(true));
                }
                break;
            case REST:
                ArrayList<AbstractCampfireOption> buttons = ReflectionHacks.getPrivate(((RestRoom)AbstractDungeon.getCurrRoom()).campfireUI, CampfireUI.class, "buttons");
                int n = 0; for (AbstractCampfireOption button : buttons) if (button.usable && n++ == i) { a.at(button.hb); break; }
                break;
            case SHOP_SCREEN: shopTarget(a, i); break;
            case CHEST:
                if (AbstractDungeon.getCurrRoom() instanceof TreasureRoom) a.at(ReflectionHacks.getPrivate(((TreasureRoom)AbstractDungeon.getCurrRoom()).chest, com.megacrit.cardcrawl.rewards.chests.AbstractChest.class, "hb"));
                if (AbstractDungeon.getCurrRoom() instanceof TreasureRoomBoss) a.at(ReflectionHacks.getPrivate(((TreasureRoomBoss)AbstractDungeon.getCurrRoom()).chest, com.megacrit.cardcrawl.rewards.chests.AbstractChest.class, "hb"));
                break;
            default: break;
        }
    }

    private static void shopTarget(Action a, int index) {
        int i = 0, gold = AbstractDungeon.player.gold;
        if (AbstractDungeon.shopScreen.purgeAvailable && gold >= ShopScreen.actualPurgeCost) {
            if (index == i++) { a.details = new JsonObject(); a.details.addProperty("price", ShopScreen.actualPurgeCost); return; }
        }
        for (AbstractCard card : ChoiceScreenUtils.getShopScreenCards()) if (card.price <= gold && index == i++) {
            a.at(card.hb); a.details = Snapshots.card(card); a.details.addProperty("price", card.price); return;
        }
        for (StoreRelic relic : ChoiceScreenUtils.getShopScreenRelics()) if (relic.price <= gold && index == i++) {
            a.at(relic.relic.hb); a.details = new JsonObject(); a.details.addProperty("price", relic.price); a.details.addProperty("description", Snapshots.text(relic.relic.description)); return;
        }
        for (StorePotion potion : ChoiceScreenUtils.getShopScreenPotions()) if (potion.price <= gold && index == i++) {
            a.at(potion.potion.hb); a.details = new JsonObject(); a.details.addProperty("price", potion.price); a.details.addProperty("description", Snapshots.text(potion.potion.description)); return;
        }
    }
}
