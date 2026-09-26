# Typed Action Results Design

Date: 2026-09-26. Issue #233. Status: design only, not implemented. It is
slice S6 of the Pi harness preparation and assumes the harness design in
[2026-09-25-pi-harness-design.md](2026-09-25-pi-harness-design.md).

## Problem

The Pi harness will call core actions as in-process tool calls. A tool call
needs to know three things about each action: whether it was sent, whether
the server confirmed it, and if it was refused, why. `WorldHandle`
(`src/wow/client.ts:160-284` on `main` at `3454e9a`) cannot say any of them:

- 64 action methods return `void`. A precondition failure is a thrown
  `Error` whose message is sometimes a snake_case code (`invalid_quest_id`),
  sometimes an English sentence (`Previous loot window has not closed`), and
  sometimes `<refusal>: <raw>` (`stop: invalid_destination`). Five actions
  do not throw at all. They write a fake SYSTEM chat line through `notify`
  (`src/wow/client-social.ts:40`) and return normally, so the daemon replies
  `OK` to an action that did nothing.
- The server's answer, when there is one, lands in a runtime state field
  (`lastOutcome`, `pending`, `lastError`, `lastOpenFailure`) and a domain
  event. Nothing ties it to the call that caused it. Group, guild, friend and
  chat refusals arrive as uncorrelated events or SYSTEM chat.
- Three methods are promise queries (`who`, `requestGuildRoster`,
  `getSpellbook`). Of the long-running actions, `walkToward` resolves a
  typed `WalkOutcome`, but `startTactics`, `startCycle` and `resumeCycle`
  resolve `void`. Their outcomes are in `TacticsState.lastOutcome` and
  `CycleState.stopCause`. `goTo` returns `void` at once and its end shows
  only in `NavigationState`.
- The PRs in flight add more of the same. Vendor (#213), trainer (#232)
  and destroy (#229) each implement a private
  `pending → confirmed | refused | unanswered` state machine with a 5 s
  timer, and each copies the same guard sentences. Use-item (#184) and the
  quest reply bound (#226) use a third vocabulary.

The daemon hides this from CLI users with `OK` (intent) and `ERR <message>`.
The [output envelope design](2026-09-22-uniform-output-envelope-design.md)
deliberately made `OK` mean "the daemon acknowledged the request", not
"the server did it". An in-process agent needs more than that, and it
should not have to scrape chat to get it.

## Goals and non-goals

- One result type for every mutating `WorldHandle` action. It distinguishes
  "refused before sending", "sent", and the server's settlement, and it
  points at the packet that settled it.
- Long-running actions (walk, route, fight, cycle, quest cycle) return
  promptly with a handle to their progress and terminal outcome, and they
  can be cancelled.
- The CLI's output stays **byte-identical**: the same daemon IPC lines, the
  same `--json` envelopes, the same `read`/`tail` event lines, and the same
  TUI output. Any user-visible change is a separate decision (see
  [Open questions](#open-questions-for-theo)).
- Non-goals: new game features, retries, a new daemon IPC protocol,
  changes to the inspection getters (`get*State`, `getNearbyEntities`), and
  changes to the three queries beyond what [Queries](#queries) states.

## Inventory

Sources: `main` at `3454e9a`, and the heads of the open PR branches on
2026-09-26. "Throws" lists the message the daemon forwards verbatim as
`ERR <message>` (`reply()`, `src/daemon/commands.ts:485-496`). Every send
can also throw `World socket is not connected`
(`src/wow/world-handlers.ts:25`), which is not repeated below.
"Confirmation" names the server evidence that exists, and whether tuicraft
handles it today. The last column is the proposed confirmation kind (see
[Confirmation kinds](#confirmation-kinds)).

### Chat and channels

All reply `OK` (bare-line chat replies `OK <MODE>`), CLI kind `intent`. No
action has a precondition.

| Method | Returns | Failure surface | Confirmation | Kind |
|---|---|---|---|---|
| `sendSay`, `sendYell`, `sendEmote`, `sendGuild`, `sendParty`, `sendRaid` | `void` | socket only. `SMSG_CHAT_RESTRICTED` becomes SYSTEM chat, uncorrelated | Own `SMSG_MESSAGE_CHAT` echo (handled, `message` event) | echo |
| `sendWhisper(target, msg)` | `void` | socket only. `SMSG_CHAT_PLAYER_NOT_FOUND` becomes SYSTEM `No player named "<n>" is currently playing.` and `SMSG_CHAT_WRONG_FACTION` becomes SYSTEM chat. Both are uncorrelated but carry the name | `SMSG_MESSAGE_CHAT` `WHISPER_INFORM` echo (handled) | echo |
| `sendChannel(ch, msg)` | `void` | socket only. `SMSG_CHANNEL_NOTIFY` errors become SYSTEM chat | Channel echo (handled) | echo |
| `sendDnd`, `sendAfk` | `void` | socket only | No reply packet; only the self `PLAYER_FLAGS` AFK/DND bit changes (not tracked) | state |
| `sendInCurrentMode(msg)` | `void` | An unknown mode is a silent no-op (`client-chat.ts:61-93`); the daemon still replies `OK <MODE>` | As the mode's method | echo |
| `setLastChatMode(mode)` | `void` | none (local) | local | local |
| `joinChannel(name, pw?)`, `leaveChannel(name)` | `void` | socket only | `SMSG_CHANNEL_NOTIFY` `YOU_JOINED`/`YOU_LEFT` (handled, SYSTEM chat); errors (wrong password, banned) become SYSTEM chat | server |
| `sendRoll(min, max)` | `void` | socket only. No range check | `MSG_RANDOM_ROLL` broadcast (handled, `ROLL` message) | server |

### Group, duel, friends, ignore, guild

| Method | Returns | Failure surface | Confirmation | Kind |
|---|---|---|---|---|
| `invite(name)`, `uninvite(name)` | `void` | socket only | `SMSG_PARTY_COMMAND_RESULT` (operation, name, result; handled as `command_result` group event), then `SMSG_GROUP_LIST` | server |
| `leaveGroup()` | `void` | socket only | `SMSG_GROUP_DESTROYED` / `SMSG_GROUP_LIST` (handled) | server |
| `setLeader(name)` | `void` | notify `"<name>" is not in your party.` and return; the daemon replies `OK` | `SMSG_GROUP_SET_LEADER` (handled, `leader_changed`) | server |
| `acceptInvite()`, `declineInvite()` | `void` | notify `Nothing to accept.` / `Nothing to decline.`; the daemon replies `OK`. Multiplexes group and duel through one `pendingRequest` slot | Group: `SMSG_GROUP_LIST`. Duel: `SMSG_DUEL_COUNTDOWN`/`COMPLETE` (handled as duel events). Decline has no answer | server / none |
| `addFriend(name)`, `addIgnore(name)` | `void` | socket only | `SMSG_FRIEND_STATUS` with a `FriendResult` (added, not found, list full, already, self, enemy; handled as friend/ignore events) | server |
| `removeFriend(name)`, `removeIgnore(name)` | `void` | notify `"<name>" is not on your friends list.` / `ignore list.`; the daemon replies `OK` | `SMSG_FRIEND_STATUS` `REMOVED` / `IGNORE_REMOVED` (handled) | server |
| `guildInvite`, `guildRemove`, `guildLeave`, `guildPromote`, `guildDemote`, `guildLeader`, `guildMotd` | `void` | socket only | `SMSG_GUILD_COMMAND_RESULT` (command, name, result; handled, but `PLAYER_NO_MORE_IN_GUILD` is dropped) and `SMSG_GUILD_EVENT` (handled) | server |
| `acceptGuildInvite()`, `declineGuildInvite()` | `void` | socket only; no pending check | Accept: `SMSG_GUILD_EVENT` joined. Decline: none (`SMSG_GUILD_DECLINE` goes to the inviter and is unregistered) | server / none |
| `getPartyState()` (#228, new) | `PartyState` | none | inspection, not an action | — |

### Control and navigation

Every mutating control verb first runs `rt.override()`
(`src/wow/runtime.ts:344-348`), which stops tactics and cycles with
`manual_override` and halts movement and combat. So an action that then
throws has still stopped the character.

| Method | Returns | Failure surface | Confirmation | Kind |
|---|---|---|---|---|
| `move(dir, ms)` | `void` | `invalid_direction`, `invalid_duration`, `no_pose`, `missing_speed`, and block reasons (`teleporting`, `rooted`, `no_control`, `disable_move`, `transport`, `flying`, `falling`, `swimming`, `disable_gravity`, `spline`) | None. Movement is client-predicted; the server only corrects (`MSG_MOVE_TELEPORT`, `SMSG_FORCE_MOVE_ROOT`, `SMSG_MOVE_KNOCK_BACK`, `SMSG_CLIENT_CONTROL_UPDATE` and others become `movement_stopped` reasons) | none |
| `face(rad)`, `faceGuid(guid)` | `void` | `invalid_orientation`, block reasons, `no_pose`; `faceGuid` also `target_not_observed`, `target_stale`, `target_map_changed`, `target_coincident` | None (`MSG_MOVE_SET_FACING` has no ack) | none |
| `selectTarget(guid)` | `void` | `invalid_guid` | None. `CMSG_SET_SELECTION` has no reply; the self `UNIT_FIELD_TARGET` update is indirect evidence (`target_observed`) | state |
| `halt()` | `void` | none | None; it sends `MSG_MOVE_STOP`, `CMSG_CANCEL_CAST`, `CMSG_ATTACKSTOP` as needed | none |
| `goTo(x, y, z)` (#144: `goTo(target)`, #128: `z?`) | `void`; the daemon replies `OK` once the route starts | `stop: invalid_destination`, `stop: no_pose`, unprefixed `missing_navigation`, `<wait\|pick_destination\|stop>: <raw navigation error>` | None; arrival is predicted. Ends in `NavigationState.blockedReason`/`refusal`. #144 adds `unreachable` and `target_lost`; #128 adds `navigation_replaced` | run, none |
| `walkToward(target, yards, signal?)` | `Promise<WalkOutcome>` (`{status: completed\|stopped, traveled, pose, reason?}`) | Rejects `invalid_distance`, `no_pose`. Every other failure resolves `stopped` with `traveled: 0`: `invalid_destination`, `destination_not_grounded`, `self_not_grounded`, `missing_navigation`, target errors, block reasons, `abort` | None; `completed` means predicted arrival | run, none |

### Combat and tactics

| Method | Returns | Failure surface | Confirmation | Kind |
|---|---|---|---|---|
| `cast(spellId, guid)` | `void` | `invalid_spell`, `invalid_guid`, `cast_in_progress`, `unknown_spell`. `cast_in_progress` can follow the override's own `CMSG_CANCEL_CAST` | `SMSG_SPELL_START` / `SMSG_SPELL_GO` (confirmed), `SMSG_CAST_FAILED` (`SpellCastResult`, numeric only), `SMSG_SPELL_FAILURE` (interrupted). Correlated by `(spellId, castCount)`. The server silently drops some casts, which leaves `pendingCast` stuck with no timeout | server |
| `attack(guid)` | `void` | `invalid_guid` | `SMSG_ATTACKSTART` confirms. A bad target gets `SMSG_ATTACKSTOP`, indistinguishable from a normal stop. `SMSG_ATTACKSWING_NOTINRANGE`/`BADFACING` come later from the swing timer and carry no guid | server |
| `cancelCast()` | `void` | `not_casting` | `SMSG_SPELL_FAILURE` interrupted | server |
| `stopAttack()` | `void` | none | `SMSG_ATTACKSTOP` only if attacking | server |
| `useItem(bag, slot)` (#184, new) | `Promise<void>`, resolved after `CMSG_USE_ITEM` is sent | `unknown_slot`, `slot_unobserved`, `empty_slot`, `item_entry_unobserved`, `unknown_item`, `no_use_spell`, `slot_changed`, `item_query_timeout`, `cast_in_progress` | As `cast`, plus `SMSG_INVENTORY_CHANGE_FAILURE` → `inventory_failed:<n>` (item guid `0` treated as a wildcard) | server |
| `startTactics(guid, instruction, signal?, framing?)` | `Promise<void>`; the daemon `FIGHT` awaits the whole fight and replies `OK` for every ending | Sync `self_not_alive`. Rejects on `missing_jev_key` or an activation error (`target_not_pve_creature`, `target_dead`, `target_not_attackable`, `unverified_hostile_relation`, `self_cannot_act`, ...). #221 changes when `server_action_rejected:*` ends the fight; #223 adds `target_friendly` | Terminal `TacticsState.lastOutcome` `{status: completed\|blocked\|failed, reason}`: `server_kill_credit` from `SMSG_LOG_XPGAIN`; `blocked` from `SMSG_CAST_FAILED`/`SMSG_ATTACKSWING_*`; `failed` from death or timeouts. Progress: `TacticsEvent` with `runId` | run, server |

### Recovery

All four actions run `rt.override()` first. The server refuses all four
silently (`MiscHandler.cpp`, `NPCHandler.cpp`). Success shows only as a
life-state transition, which starts a new recovery epoch.

| Method | Returns | Failure surface | Confirmation | Kind |
|---|---|---|---|---|
| `queryCorpse()` | `void` (runtime returns `RecoveryState`, dropped) | `Recovery runtime disposed`, `Authenticated player GUID is unknown`, `Previous corpse query remains unanswered` | `MSG_CORPSE_QUERY` reply, found or not (handled) | server |
| `releaseSpirit()` | `void` | `Release requires authoritative dead state` | Ghost flag update; `SMSG_DEATH_RELEASE_LOC` | state |
| `reclaimCorpse()` | `void` | `Cannot request reclaim: <life_unknown\|not_ghost\|corpse_unknown\|corpse_absent\|corpse_position_unknown\|pose_unknown\|corpse_map_mismatch\|corpse_out_of_range\|reclaim_delay>` | Alive transition | state |
| `activateSpiritHealer(guid)` | `void` | `Spirit-healer activation requires observed ghost state`, `Previous spirit-healer request remains unanswered`, `Spirit-healer GUID is unknown`, `Observed creature is not a spirit healer` | Alive transition (`SMSG_SPIRIT_HEALER_CONFIRM` is battleground-only) | state |
| `respondResurrection(accept)` | `void` | `Resurrection response requires observed dead or ghost state`, `No current resurrection offer`, `Resurrection offer already answered`, `Resurrection offer delay has not elapsed` | Accept: alive transition. Decline: none. `SMSG_PRE_RESURRECT` is unhandled | state / none |

### Quests

The quest runtime already correlates one pending request at a time
(`src/wow/quests.ts:339-347`). #226 bounds it with a 5 s timer and moves
expired intents to `QuestState.unresolved[]` with reason `no_reply`, which
is the closest existing precedent for this design.

| Method | Returns | Failure surface | Confirmation | Kind |
|---|---|---|---|---|
| `talk(guid)` | `void` | `quests_disposed`, `quest_reply_unanswered` (#226 adds detail), `invalid_guid` | `SMSG_GOSSIP_MESSAGE` or a questgiver dialog; #226 adds `unsupported_window:<trainer\|vendor\|bank\|taxi>` | server |
| `queryQuest(questId)` | `void` | `invalid_quest_id`; no pending barrier | `SMSG_QUEST_QUERY_RESPONSE` | server |
| `selectGossipOption(id, code?)` | `void` | `gossip_not_open`, `option_not_offered`, `gossip_code_required`, `gossip_code_not_offered`, busy | Next dialog packet | server |
| `selectQuest(questId)` | `void` | `invalid_quest_id`, `quest_not_offered`, busy | `SMSG_QUESTGIVER_QUEST_DETAILS` (or request items) | server |
| `acceptQuest()` | `void` | `quest_details_not_open`, `quest_accept_not_offered`, `quest_already_in_log`, busy | No direct ack. Quest log field transition; `SMSG_QUESTLOG_FULL` refuses | state |
| `completeQuest(questId)` | `void` | `invalid_quest_id`, `quest_not_offered`, busy | `SMSG_QUESTGIVER_REQUEST_ITEMS`; `SMSG_QUESTGIVER_QUEST_INVALID` refuses | server |
| `requestQuestReward()` | `void` | `quest_request_items_not_open`, `quest_requirements_unmet`, busy | `SMSG_QUESTGIVER_OFFER_REWARD` | server |
| `chooseQuestReward(i)` | `void` | `reward_offer_not_open`, `reward_not_offered`, busy | `SMSG_QUESTGIVER_QUEST_COMPLETE`; `SMSG_QUESTGIVER_QUEST_FAILED` refuses; #229 maps `SMSG_INVENTORY_CHANGE_FAILURE` to an inventory refusal | server |
| `abandonQuest(slot)` | `void` | `invalid_quest_slot`, `quest_slot_unknown`, `quest_slot_empty`, busy | Quest log transition | state |
| `cancelInteraction()` | `void` | `quest_cancel_unanswered` | `SMSG_GOSSIP_COMPLETE`, otherwise expiry | server |

### Loot and rolls

| Method | Returns | Failure surface | Confirmation | Kind |
|---|---|---|---|---|
| `openLoot(guid)` | `void` | `Rewards runtime disposed`, `Authenticated player GUID is unknown`, `Previous loot window has not closed`, `Loot source is not an observed creature`, `Loot source is not authoritatively dead`, `Creature has no observed lootable flag`, `Loot action requires authoritative alive state` | `SMSG_LOOT_RESPONSE` (window or error). #176 adds async `loot_open_failed` (`release_only` after 3 s, `loot_source_unavailable`, `self_unavailable`) | server |
| `takeLoot(slot)` | `void` | `No open server-observed loot window`, `Loot window is invalid: <r>`, `Previous loot request remains unanswered`, `Loot slot was not offered`, `Loot slot is not available for direct pickup` | `SMSG_LOOT_REMOVED`, `SMSG_ITEM_PUSH_RESULT`; `SMSG_INVENTORY_CHANGE_FAILURE` refuses | server |
| `takeLootMoney()` | `void` | as `takeLoot`, plus `Loot window has no offered money` | `SMSG_LOOT_CLEAR_MONEY`, `SMSG_LOOT_MONEY_NOTIFY` | server |
| `releaseLoot()` | `void` | `No open loot window to close` (#173 makes a closed window a no-op) | `SMSG_LOOT_RELEASE_RESPONSE`. #173/#176 add an implicit release after the last item | server |
| `rollLoot(guid, slot, choice)` (#206, planned) | — | not pending, choice not allowed | `CMSG_LOOT_ROLL` answered by `SMSG_LOOT_ROLL`, then `SMSG_LOOT_ROLL_WON` or `SMSG_LOOT_ALL_PASSED`; none are handled today | server |

### Vendor, trainer, destroy (open PRs)

Each runtime keeps `pending` and `lastOutcome {status: confirmed | refused |
partial | unanswered, reason}` with a 5 s answer timer, and throws the same
four guard sentences (`<X> runtime disposed`, `Authenticated player GUID is
unknown`, `<X> requires authoritative alive state`, `Previous <x> request
remains unanswered`).

| Method | Returns | Failure surface | Confirmation | Kind |
|---|---|---|---|---|
| `openVendor(guid)` (#213) | `void` | guards, `Creature is not an observed vendor` | `SMSG_LIST_INVENTORY`; no refusal packet, so timeout only | server |
| `sellItem(bag, slot, count?)` (#213) | `void` | guards, `No listed vendor`, `No carried bag item at bag <b> slot <s>`, `Sell count exceeds the stack` | No success packet: stack drop plus coinage rise. `SMSG_SELL_ITEM` refuses (item guid `0` wildcard) | state |
| `buyItem(slot, count?)` (#213) | `void` | guards, `Vendor slot was not offered` | `SMSG_BUY_ITEM` plus coinage drop; `SMSG_BUY_FAILED` (item id `0` wildcard) or `SMSG_INVENTORY_CHANGE_FAILURE` refuses | server |
| `repairAll()` (#213) | `void` | guards, `Vendor does not repair`, `Nothing needs repair` | No reply handled; durability and coinage change, else `partial`/`unanswered` | state |
| `openTrainer(guid)` (#232) | `void` | guards, `Creature is not an observed trainer` | `SMSG_TRAINER_LIST`; timeout only | server |
| `trainSpell(spellId)` (#232) | `void` | guards, `No listed trainer`, `Spell is not offered by this trainer`, `Spell is <too_low\|unavailable\|known>` | `SMSG_TRAINER_BUY_SUCCEEDED` plus coinage drop plus a learned spell; `SMSG_TRAINER_BUY_FAILED` refuses | server |
| `destroyItem(bag, slot, count?)` (#229) | `void` | guards, `No carried bag item at bag <b> slot <s>`, `Destroy count exceeds the stack`, `Partial destroy count is limited to 255` | No ack: stack change. Any `SMSG_INVENTORY_CHANGE_FAILURE` while pending refuses (uncorrelated) | state |

#226 routes `SMSG_TRAINER_LIST` and `SMSG_LIST_INVENTORY` into the quest
runtime while #232 and #213 register the same opcodes. That clash has to be
resolved when they land, independent of this design.

### Cycles and the quest loop

| Method | Returns | Failure surface | Confirmation | Kind |
|---|---|---|---|---|
| `startCycle(guids, instruction, max?)` | `Promise<void>`; the daemon `CYCLE` awaits the whole cycle, then `OK` | Rejects `cycle_disposed`, `cycle_empty_queue`, `cycle_invalid_max` | No opcode. Terminal `CycleState.stopCause`: `queue_exhausted`, `max_starts_reached`, `halt`, `manual_override`, recovery causes (`life_unknown`, `corpse_query_timeout`, `corpse_absent`, `corpse_out_of_range`, `reclaim_delayed`), loot causes (`loot_denied:*`, `loot_inventory_full`, `loot_release_unconfirmed`, `target_death_unconfirmed`). #148 removes `reclaimed`/`resurrected` as stops and adds a `recovered` event. Progress: `CycleEvent` `started`, `target_done`, `loot_done`, `recovery`, `resumed`, `stopped` | run |
| `resumeCycle(instruction?, max?)` | `Promise<void>` | `cycle_disposed`, `cycle_active`, `cycle_nothing_to_resume`, `cycle_invalid_max` | as `startCycle` | run |
| `stopCycle()` | `void` | none; no-op when idle | local; ends the run with the given cause | local |
| `startQuestCycle(questId, sources, instruction, max?)` (#223, new) | `Promise<void>`; reached as `cycle --quest`, `OK` at loop end | `quest_not_in_log`, `quest_query_unanswered`, `objective_gameobject_unsupported`, `objective_item_sources_unknown`, `objective_unsupported` | `CMSG_QUEST_QUERY` then quest log updates. Terminal causes add `objective_complete`, `objective_targets_absent`, `objective_targets_out_of_reach`, `quest_not_in_log`, `quest_log_unobserved`, `quest_failed`, `self_pose_unobserved`. Progress: cycle events plus `CycleState.objective` | run |

### Queries and inspections

`who`, `requestGuildRoster` and `getSpellbook` return `Promise<T>` and
reject on a barrier timeout or missing data. `getTrainerState` (#232) is
async too. `queryNearby` (#163) and `observeNavigation` (#164) are pure
reads. The refactors #160 (barrel) and #161 (internal `WorldConn`) change
no method.

### What the inventory shows

- Every `ERR` except `cast_in_progress` means nothing was sent. An `OK`
  means "sent", or, for the five `notify` cases, "nothing happened".
- Server evidence exists for most actions, and tuicraft already handles it,
  but it is kept as "last value" state rather than tied to a call.
- There are four confirmation shapes: a reply packet, an echo of the
  player's own message, a state transition with no reply packet (sell,
  destroy, accept, recovery, target), and nothing at all (movement, facing,
  halt, decline).
- Refusal vocabulary mixes codes and sentences, and new PRs duplicate the
  same guard sentences per runtime.
- Five correlation keys cover every action: guid, name, quest id or log
  slot, bag and slot, and spell id with cast count.

## Design

### Result type

A new core module, `src/wow/action-result.ts`, defines:

```ts
type ActionName = "say" | "whisper" | "invite" | "open_loot" | "go_to" | "cast";

type Evidence = {
  source: string;
  at: number;
};

type ActionKey =
  | { guid: bigint }
  | { name: string }
  | { questId: number }
  | { slot: number }
  | { bag: number; slot: number }
  | { spellId: number; castCount: number }
  | Record<string, never>;

type Confirmation = "server" | "echo" | "state" | "none";

type Refused<R extends string> = {
  status: "refused";
  action: ActionName;
  reason: R | CommonRefusal;
  detail?: JsonObject;
};

type Sent<T, R extends string> = {
  status: "sent";
  id: number;
  action: ActionName;
  key: ActionKey;
  confirmation: Confirmation;
  settled: Promise<Settlement<T, R>>;
};

type Settlement<T, R extends string> =
  | { status: "confirmed"; value: T; evidence: Evidence[] }
  | { status: "refused"; reason: R; detail?: JsonObject; evidence: Evidence[] }
  | { status: "unanswered"; waitedMs: number }
  | { status: "superseded"; by: "halt" | "manual_override" | "replaced" | "disconnect" }
  | { status: "unconfirmable" };

type ActionResult<T = null, R extends string = never> = Refused<R> | Sent<T, R>;

type CommonRefusal =
  | "disconnected"
  | "disposed"
  | "self_unknown"
  | "self_not_alive"
  | "busy";
```

Rules:

- `ActionName` has one snake_case member per action method; the union
  above is abbreviated.
- `refused` means nothing was sent. It replaces every precondition throw,
  including `World socket is not connected` (`disconnected`), the four
  guard sentences (`disposed`, `self_unknown`, `self_not_alive`, `busy`) and
  the five `notify` cases. Reasons are snake_case codes in a closed union
  per action. `detail` carries what the old sentence interpolated (`bag`,
  `slot`, the navigation `raw` error, the reclaim reason, the pending action
  and age for `busy`).
- `sent` is returned after the packet is written. `id` is a per-session
  counter, and `key` is the value that settlement matches on. The result
  is returned synchronously, except where the precondition needs I/O first
  (`useItem`'s item query, `startTactics`'s activation, `startQuestCycle`'s
  quest query). Those methods return `Promise<ActionResult>`, which
  resolves as soon as the action is either refused or sent.
- `settled` always settles and never rejects. `confirmed` and `refused`
  carry the evidence that decided it. `unanswered` means the action's
  answer window passed. `superseded` means halt, override, a replacing
  action or disconnect ended it first. `unconfirmable` settles immediately
  for `confirmation: "none"`, so callers do not need a special case.
- `Evidence.source` is the opcode name from `protocol/opcodes.ts`
  (`SMSG_LOOT_RESPONSE`) or, for state confirmations, `update:<field>`
  (`update:PLAYER_FIELD_COINAGE`). `at` uses the same clock as event
  timestamps, so a caller can find the matching entry in the game log.

### Confirmation kinds

- **server**: a reply packet settles it. Correlate it by `key` against the
  one pending request of that domain. The server refusal codes become
  `reason` through the existing name tables (`FriendResult`,
  `PartyResult`, `GuildCommandResult`, `InventoryResult`,
  `SpellCastResult`, `sellResultName`, `buyResultName`,
  `trainerFailureName`). Numeric-only codes fall back to `<table>_<n>`, as
  vendor and trainer already do.
- **echo**: the player's own chat line coming back
  (`sender === self`, the same chat type and text, or `WHISPER_INFORM` to
  the target) confirms it. `SMSG_CHAT_PLAYER_NOT_FOUND` and
  `SMSG_CHAT_WRONG_FACTION` refuse a pending whisper to that name.
- **state**: an update field transition settles it (coinage and stack for
  sell and destroy, quest log for accept and abandon, life state for
  recovery, `UNIT_FIELD_TARGET` for target). This is exactly what #213 and
  #229 implement privately.
- **none**: the protocol has no answer (movement, facing, halt, decline,
  DND/AFK). `settled` resolves `unconfirmable`.

### Pending ledger

One small class, `ActionLedger`, replaces the per-runtime pending
machinery (`QuestRuntime.pending`/`unresolved`,
`RewardsRuntime.pending`, the vendor, trainer and destroy `pending` plus
`lastOutcome` plus timer, and `RecoveryRuntime.request`). It:

- keeps pending entries per **domain**. The domains that enforce one
  request at a time today (`quest`, `loot`, `vendor`, `trainer`,
  `destroy`, `recovery`, `cast`) stay exclusive: a second action is
  refused `busy`, which is today's `... remains unanswered` rule made
  uniform. The others (`chat`, `group`, `guild`, `friends`, `who`) never
  refuse `busy`; they queue entries and settle the oldest one whose key
  matches, so sending two says in a row still works;
- starts the answer timer (5 s by default, as vendor, trainer, destroy,
  quest and use-item already use; 30 s for recovery transitions, as
  `corpse-run.ts` uses);
- exposes `settle(domain, key, settlement)`, which handlers call where they
  set `lastOutcome` today, and `supersede(by)`, which `rt.override()`,
  `halt()` and `cleanupSession` call;
- emits one `ActionEvent` (`sent` and `settled`, with `id`, `action`,
  `key`) on a new `conn.events.action` emitter
  (`src/wow/world-events.ts`).

The existing state fields (`lastOutcome`, `lastError`, `unresolved`,
`lastOpenFailure`) stay: inspections render them, and the byte-identity
rule keeps them. They are written from the ledger's settlement instead of
alongside it.

### Long-running actions

A run is a `Sent` result with extra members:

```ts
type Run<P, T, C extends string> = Omit<Sent<T, C>, "settled"> & {
  progress: (cb: (event: P) => void) => Unsubscribe;
  cancel: (reason?: "halt" | "replaced") => void;
  settled: Promise<RunEnd<T, C>>;
};

type RunEnd<T, C extends string> =
  | { status: "completed"; value: T; evidence: Evidence[] }
  | { status: "stopped"; cause: C; value: T; evidence: Evidence[] }
  | { status: "superseded"; by: "halt" | "manual_override" | "replaced" | "disconnect"; value: T };
```

`value` always carries today's terminal object, so no information is
lost and the daemon can print exactly what it prints now:

| Run | Method returns | `progress` source | `completed` when | `value` |
|---|---|---|---|---|
| walk | `ActionResult` whose sent branch is `Run<ControlEvent, WalkOutcome, reason>` | `ControlEvent` while the walk is active | `WalkOutcome.status === "completed"` | `WalkOutcome` |
| route (`goTo`) | same shape | `ControlEvent` for the route | reason `arrived` | `NavigationState` at the end |
| fight | `Promise<ActionResult>`, resolved after activation | `TacticsEvent` filtered by `runId` | `lastOutcome.status === "completed"` | `TacticsOutcome` |
| cycle, resume, quest cycle | `ActionResult` (`Promise<ActionResult>` for the quest cycle) | `CycleEvent` (with `CycleState.objective` for quest cycles) | `queue_exhausted` or `objective_complete` | `CycleState` at the stop |

`cancel()` calls the existing stop path (`tactics.stop`, `cycle.stop`,
`control.halt`), so a cancelled run settles `superseded`. The existing
`AbortSignal` parameters stay, because the daemon wires its socket abort
through them.

For a run, `refused` means the run did not start. A fight's activation
can already have sent `CMSG_SET_SELECTION` and run `rt.override()` before it
fails, exactly as today; `detail.stage: "activation"` marks that case.

### Queries

`who`, `requestGuildRoster` and `getSpellbook` stay `Promise<T>`: they
are reads, not actions, and the harness can wrap a rejection as a tool
error. Only their concurrency bug is in scope. `who` has no persistent
`SMSG_WHO` handler, so two concurrent calls race on one barrier. It should
queue in the ledger's `who` domain so that concurrent calls settle in order.

### Daemon mapping with byte-identical output

The daemon keeps its IPC lines. One adapter in `src/daemon/commands.ts`
replaces `reply(socket, () => handle.x(), ok)` for actions:

```ts
function act(socket, run, { awaitSettled, render }) {
  const result = await run();
  if (result.status === "refused")
    return writeLines(socket, [`ERR ${refusalText(result)}`]);
  if (!awaitSettled) return writeLines(socket, ["OK"]);
  const end = await result.settled;
  writeLines(socket, render ? render(end.value) : ["OK"]);
}
```

- **Instant actions** reply `OK` on `sent` and do not await `settled`,
  which is today's timing. `OK <MODE>` for bare chat stays in the chat
  handler.
- **Runs** that the daemon awaits today (`walk_toward`, `fight`, `cycle`,
  `cycle_resume`, `cycle --quest`) await `settled`. `walk_toward` renders
  `JSON.stringify(end.value)`, the same `WalkOutcome` line. The others
  write `OK` for every ending, as now. `goto` does not await, as now.
- **Refusal text.** `refusalText(result)` lives in the surface layer
  (`src/ui/format-refusal.ts`) and maps `(action, reason, detail)` back to
  the exact sentence each action throws today, for example
  `(take_loot, busy)` → `Previous loot request remains unanswered` and
  `(go_to, pick_destination, {raw})` → `pick_destination: <raw>`. A
  table-driven unit test asserts that every reason of every migrated action
  maps to its old string. The strings come from this inventory.
- **The five `notify` refusals** (`setLeader`, `removeFriend`,
  `removeIgnore`, `acceptInvite`, `declineInvite`) return `refused`, and
  their core methods keep emitting the same SYSTEM chat until Theo decides
  otherwise (question 1). The daemon keeps replying `OK` for those
  reasons, through an explicit `LEGACY_OK` set in the adapter, so both the
  reply and the SYSTEM event line stay the same. The same applies to
  `sendInCurrentMode` with an unknown mode.
- **Halt preemption** is unchanged. A queued command dropped by `HALT`
  (`src/daemon/server.ts`) still gets no reply. In-process callers see
  `superseded`.
- **Events** are unchanged. `ActionEvent` is not subscribed by the daemon's
  event ring buffer or session log, so `read`, `tail` and `logs` output
  does not change, and no `id` field is added to existing domain event
  JSON.
- **The CLI** needs no change. `decodeReply` and `formatHumanIntent`
  (`src/cli/send-output.ts`) still see the same lines, so the envelopes and
  the human "Daemon accepted request" text are identical. The TUI ignores
  return values today and keeps doing so.

Each migration slice proves byte identity the same way. The existing
daemon dispatch tests (`src/daemon/commands-*.test.ts`) pin the exact
reply lines for each verb, and they must pass unmodified. The slice adds
cases only where a reason had no test.

### Harness consumption

A harness tool is a thin wrapper that returns the result as JSON:

```ts
pi.registerTool({
  name: "wow_open_loot",
  parameters: Type.Object({ guid: Type.String() }),
  async execute(_callId, { guid }, signal) {
    const result = handle.openLoot(BigInt(guid));
    if (result.status === "refused") return toolJson(result);
    return toolJson(await settledOrAbort(result.settled, signal));
  },
});
```

- Instant actions await `settled`. The answer window bounds the wait, so
  the tool returns `confirmed`, `refused` (with the server's reason and
  evidence), `unanswered`, `superseded` or `unconfirmable`. The model never
  has to read chat to learn that a whisper target was offline.
- Runs return at once with `{status: "sent", id, action, key}`, which
  meets harness milestone 4 ("long-running actions return promptly and are
  observable and cancellable"). The harness subscribes to `progress` for
  its panel and log, and pushes the `RunEnd` into the conversation with
  `pi.sendMessage(..., { triggerTurn: true })` when it settles. Companion
  tools `wow_wait(id)` and `wow_cancel(id)` look the run up by `id`.
- The ledger's domains tell the harness which tool calls conflict. Calls
  in one exclusive domain should be serialized by the harness; if they are
  not, the second gets a `busy` refusal, which is a normal result rather
  than an exception. Parallel calls in different domains are safe.
- `ActionEvent`s feed the harness's game log, so the model can search
  "what did I do, and what did the server say" with the same log tools it
  uses for chat.

## Migration plan

Every slice is one PR with one issue, changes one domain end to end (core
signature, ledger use, daemon adapter, `mock-handle.ts`), keeps CLI output
byte-identical, and deletes the private pending machinery it replaces. The
order follows the PRs in flight, so no slice rebases over an unlanded
feature. "After" lists PRs that must land (or close) first.

1. **Ledger, types and friends/ignore.** After #160 and #161, so the types
   export from the barrel and the ledger can live beside the internal
   `WorldConn`. Adds `action-result.ts`, `ActionLedger`,
   `conn.events.action`, the `act` adapter, `refusalText`, and migrates
   `addFriend`, `removeFriend`, `addIgnore`, `removeIgnore` (name keyed,
   `FriendResult` refusals, two legacy `notify` cases). Updates the pattern
   charter's "a command method returns `void`" rule. Live: `mise test:live`
   plus add, remove and re-add a friend and an ignore between the two soap
   characters, with an unknown name, and compare the CLI transcript with
   `main`.
2. **Group, duel and guild.** After #228. Migrates `invite`, `uninvite`,
   `leaveGroup`, `setLeader`, `acceptInvite`, `declineInvite` and the nine
   guild actions (`PARTY_COMMAND_RESULT` and `GUILD_COMMAND_RESULT` keyed by
   name and operation). Live: `mise test:live` (it covers invite, accept,
   leader and leave with two accounts), plus invite of an offline name.
3. **Chat and channels.** After #191 and #230. Echo confirmation for
   say, yell, party, guild, whisper, emote and channel; refusal for
   whisper not found and wrong faction; the `who` domain. Live:
   `mise test:live` chat cases, a whisper to a nonexistent name, and two
   concurrent `who` calls.
4. **Loot.** After #173 and #176. Migrates `openLoot`, `takeLoot`,
   `takeLootMoney` and `releaseLoot`; the async `loot_open_failed` becomes
   a settlement; `loot-run.ts` waits on `settled` instead of its own
   `EventWaiter`s. Live: `mise test:live`, then kill and loot a mob
   (`fresh` account), and take and release loot.
5. **Loot rolls (#206).** Built directly on the result type, as the first
   new action born typed. Live as #206's acceptance criteria.
6. **Quests.** After #226, #152, #153 and #223. The quest pending,
   `unresolved[]` and the 5 s bound move into the ledger; `unresolved`
   stays as a rendered view. Live: `mise test:live` (it includes
   `live-quest.ts`), and quest 8325 accept, abandon and turn-in on a fresh
   character.
7. **Vendor, trainer, destroy and use-item.** After #213, #232, #229 and
   #184. Mechanical, because these PRs already have the right state
   machine. Their `lastOutcome` statuses map one to one (`partial` becomes
   `refused` with reason `partial`). Removes the four duplicated guard
   sentences. Live: `mise test:live`; buy, sell and repair at a vendor;
   train a spell at level 2 (`eversong10`); destroy one item; use a food
   item.
8. **Combat single actions.** After #221, #186 and #190. `cast`, `attack`,
   `cancelCast` and `stopAttack`, keyed by `(spellId, castCount)` and
   victim guid, with a 5 s answer window. That window changes one
   behaviour: a cast the server silently dropped no longer blocks every
   later `cast` with `cast_in_progress`. The PR must call this out as the
   only non-identical output. Live: `mise test:live`, cast on a mob, an
   out-of-range cast, and cancel mid-cast.
9. **Recovery.** After #225, #187 and #148. State confirmation by life
   transition and 30 s windows; `corpse-run.ts` waits on `settled`. Live:
   die to a mob, release, run back and reclaim; then die again and use the
   spirit healer; and accept a resurrection if a caster is available.
10. **Instant control.** After #192, #172, #122 and #155. `move`, `face`,
    `faceGuid`, `selectTarget` and `halt`. Mostly `unconfirmable`;
    `selectTarget` confirms by state. Live: `mise test:live` (its forced
    teleport and `.freeze` cases), plus `move`, `face` and `target` by hand.
11. **Runs.** After #144, #128, #145, #164 for walk and route; after #221,
    #174, #139, #142, #186, #190 for fight; after #148, #149, #223 for
    cycles. `walkToward`, `goTo`, `startTactics`, `startCycle`,
    `resumeCycle` and `startQuestCycle` become `Run`s. This slice can be
    three PRs, one per run type. Live: `mise test:live`, a `goto` and
    `walk-toward`, one `fight` to kill credit, one blocked fight, one
    `cycle` of two mobs and one `cycle --quest`, each compared with `main`.

After slice 11, `WorldHandle` has no `void` action, and the harness tool
surface (harness milestone 4) can be written against it. Slices 1 to 10
touch disjoint domains, so they can land in any order once their "after"
PRs land. Slice 11 is last, as the scout ordering for S6 asked.

## Risks

- **Byte-identity through translation.** `refusalText` must reproduce
  interpolated sentences exactly. The table test in each slice, plus the
  unchanged dispatch tests, is the guard.
- **False correlation.** Group, guild and chat refusals carry a name but
  no request id. Matching by name and operation against the pending
  entries keeps this sound; a refusal that matches no pending entry stays
  an ordinary event, as today.
- **Answer windows are guesses.** A late reply after `unanswered` is still
  recorded in state and events. It does not re-settle the result.
- **False matches in queued domains.** Two whispers to the same name are
  settled oldest first. The echo carries the text, so the match uses name
  and text; a refusal (`PLAYER_NOT_FOUND`) carries only the name and
  settles the oldest whisper to that name, which is the one the server
  refused, since it answers in order.

## Open questions for Theo

1. **Silent refusals.** Should `setLeader`, `removeFriend`, `removeIgnore`,
   `acceptInvite` and `declineInvite` (and chat with an unknown mode) reply
   `ERR <reason>` instead of `OK` plus a SYSTEM chat line? This is a
   user-visible change; the design keeps today's output until you decide.
2. **Confirmation in the CLI.** Should mutating verbs gain an opt-in wait
   (for example `--confirm`) that prints the settlement as a `kind:
   "result"` envelope? The envelope design excluded server-outcome
   inference, so this needs your decision.
3. **Action events in logs.** Should `ActionEvent`s appear in `read`,
   `tail` and the session log as an `[action]` domain? This helps CLI
   agents but changes their event stream.
4. **Walk pre-checks.** Today `walk-toward` answers `invalid_destination`,
   `destination_not_grounded` and similar with a `stopped` outcome and
   `traveled: 0`, while `invalid_distance` is an `ERR`. Should they all
   become `ERR`? The design keeps today's split.
5. **Refusal wording.** Should the CLI switch to the snake_case reason codes
   (with detail) everywhere and drop the English sentences? It is simpler
   and consistent, but it is a visible change and needs the four doc
   places updated.
6. **Opcode ownership.** #226 and #213/#232 register the same
   `SMSG_LIST_INVENTORY` and `SMSG_TRAINER_LIST` handlers. Which PR owns
   them, or should the dispatcher become multi-subscriber like the event
   bus?
7. **Quest cycle entry point.** #223 reaches the quest loop through
   `cycle --quest`. Should the harness see one `cycle` tool or a separate
   `quest_cycle` tool? The core can offer either.
