export function helpText(): string {
  return `tuicraft — WoW 3.3.5a chat client

USAGE
  tuicraft                    Interactive TUI mode
  tuicraft setup [flags]      Configure account credentials
  tuicraft send "message"     Send a say message (auto-starts daemon)
  tuicraft send -w <name> "m" Whisper a player
  tuicraft send -y "message"  Yell
  tuicraft send -g "message"  Guild chat
  tuicraft send -p "message"  Party chat
  tuicraft who [filter]       Who query
  tuicraft read [--wait N] [--json]  Read buffered events
  tuicraft tail [--json]      Continuous event stream
  tuicraft start [--json]    Start background daemon and connect
  tuicraft status [--json]   Show daemon socket status
  tuicraft control [--json]  Current pose estimate, last server pose, refusal guidance
  tuicraft move <dir> [ms]   Walk 1-10000ms (default 1000)
  tuicraft face <radians>    Set facing in radians
  tuicraft face-guid <guid>  Face a currently observed GUID
  tuicraft walk-toward <yards> <guid>|<x> <y> <z>  Bounded direct leg (>0 to 20yd); JSON terminal outcome
  tuicraft target <guid>     Request target (uint64 hex/decimal; 0 clears)
  tuicraft halt              Cancel motion, cast, attack, tactics, cycle
                            Drop older queued mutations on this socket; not sent requests
  tuicraft nearby [--all] [--json]  Nearby 3D/XY distance and facing from current pose
  tuicraft combat [--json]   Combat state
  tuicraft spells [--json]   Learned spellbook
                            After reconnect, run once if all learned spells appear in unknownLearned
  tuicraft cast <id> <guid>  Cast a learned spell
  tuicraft attack <guid>     Start auto-attack
  tuicraft cancel-cast       Interrupt current cast
  tuicraft stop-attack       Stop auto-attack
  tuicraft fight [--framing <variant>] <guid> [instruction...] [--json]  Jev tactics (default: stay alive and defeat target)
                            Spell kit needs observed form 0; inspect tactics on refusal
  tuicraft tactics [--json]  Tactics state and terminal observations
  tuicraft cycle <guid...> [--instruction ...] [--max N] [--json]  Explicit nearby GUID queue; no auto-acquire; a death reclaims, then stops
  tuicraft cycling [--json]  Cycle phase, queue (loot: looted|none), loot requests and stop cause
  tuicraft goto <x> <y> <z> [--json]  Walk a ground route
  tuicraft navigation [--json]  Navigation state and refusal next step
  tuicraft recovery [--json]  Observed life, corpse, delay and request state
  tuicraft release-spirit     Request release from observed dead state
  tuicraft query-corpse       Request current corpse information
  tuicraft reclaim-corpse     Request guarded corpse reclaim
  tuicraft spirit-healer <guid>  Request resurrection from an observed healer-flagged creature
  tuicraft resurrect accept|decline  Answer the current resurrection offer
                            OK is request intent, not confirmed recovery
                            Corpse run: inspect, release if dead, use found corpse or query once, face/move, reclaim
                            Near a killer: plan an exit, flee after OK, then inspect observed life
  tuicraft quests [--json]    Offered dialog, quest log and one pending mutation
  tuicraft talk <guid>        Request a conversation with an observed giver
  tuicraft query-quest <id>   Request quest metadata (not authorization)
  tuicraft select-option <id> [code]  Choose an offered gossip option
                            Quote one code argument; omitted differs from empty
  tuicraft select-quest <id>  Choose a quest from the offered menu
  tuicraft accept-quest      Request acceptance of offered details
  tuicraft complete-quest <id>  Request offered quest completion
  tuicraft request-reward    Request the current quest reward offer
  tuicraft choose-reward <index>  Choose offered reward (zero-based 0-5)
  tuicraft abandon-quest <slot>  Request log-slot abandonment (zero-based 0-24)
  tuicraft cancel-interaction  Request close; wait for observed close
                            OK is intent, not accepted/completed/rewarded state
  tuicraft inventory [--json]  Observed carried items, coinage and unknown fields
  tuicraft loot [--json]      Loot offer, pending intent and inventory evidence
  tuicraft open-loot <guid>  Request loot from an observed lootable corpse
  tuicraft take-loot <slot>  Request an offered uint8 loot slot (0-255)
  tuicraft take-money        Request money from the current offer
  tuicraft release-loot      Request close of the open loot window
                            OK/slot removal is not stored gain
                            Item-push slot 0xFFFFFFFF means stacking, not a bag slot
                            Release-only opening stays unanswered; reconnect explicitly
  tuicraft stop [--json]      Stop the daemon
  tuicraft logs               Print session log
  tuicraft skill              Print SKILL.md for AI agents
  tuicraft version            Print version and exit
  tuicraft help               Show this help

FLAGS
  -v, --version   Print version and exit
  -h, --help      Show this help
  --json          All daemon-backed commands: chat, queries, gameplay actions, start, status, stop, read, tail
  --all           Output all tracked entities without distance filter (nearby), including transports and off-map (>100yd)
  --wait N        read/send: return unread events, waiting up to N seconds for one
  --daemon        Start as background daemon (internal)

JSON OUTPUT
  Finite --json commands print one envelope and newline, including empty results and errors:
    {"command":"fight","kind":"intent","data":null,"events":[],"error":null}
  tail --json prints JSONL: one envelope per event, no line for an empty poll:
    {"command":"tail","kind":"events","data":null,"events":[{"type":"SAY","sender":"A","message":"hi"}],"error":null}
  Every envelope has command, kind, data, events, error. Chat aliases use command=send.
  kind=intent|result|events|error; data contains query JSON; events holds event objects.
  read returns events (events:[] when empty); nearby returns data:[] when empty.
  send --wait --json returns one envelope with waited events, not separate lines.
  kind=intent acknowledges a request, not its game-world outcome. Inspect state/events.
  Errors use error.stage=arguments|startup|command|wait and exit 1; a wait error
  keeps the original kind and data. All JSON errors print to stdout.
  logs and skill remain raw; --json is unsupported for them, setup, help, version,
  interactive mode and internal daemon mode.
  Without --json, cycling, recovery, inventory and loot print readable summaries.
  Control actions print daemon request acceptance, not a server result.
  fight and cycle reply when the run ends; check tactics or cycling for the outcome.

SETUP FLAGS
  --account NAME  Account name (required)
  --password PASS Password (required)
  --character NAME Character name (required)
  --host HOST     Auth server hostname (default: t1)
  --port PORT     Auth server port (default: 3724)
  --language ID   Chat language code (default: 1/Orcish)
  --timeout_minutes N  Daemon idle timeout (default: 30)

INTERACTIVE COMMANDS (TUI mode)
  /s, /y, /w, /g, /p, /raid, /e, /1, /2  Chat commands
  /dnd [message]  Toggle Do Not Disturb status
  /afk [message]  Toggle Away From Keyboard status
  /r              Reply to last whisper
  /join <channel> Join a chat channel
  /leave <chan>   Leave a chat channel
  /who [filter]   Who search
  /invite <name>  Invite player to group
  /kick <name>    Remove player from group
  /leave          Leave the current group
  /leader <name>  Transfer group leadership
  /accept         Accept pending invitation (group or duel)
  /decline        Decline pending invitation (group or duel)
  /roll [N] [M]   Roll random number (default 1-100)
  /friends        Show your friends list
  /friend add <n> Add a player to friends
  /friend remove  Remove a player from friends
  /ignore <name>  Add a player to ignore list
  /unignore <n>   Remove a player from ignore
  /ignorelist     Show your ignore list
  /groster        Show guild roster
  /ginvite <name> Invite player to guild
  /gkick <name>   Remove player from guild
  /gleave         Leave the guild
  /gpromote <name> Promote guild member
  /gdemote <name> Demote guild member
  /gleader <name> Transfer guild leadership
  /gmotd [msg]    Set guild message of the day
  /gaccept        Accept guild invitation
  /gdecline       Decline guild invitation
  /tuicraft entities on|off  Toggle entity event display
  /quit           Disconnect and exit

DAEMON
  The daemon starts automatically when needed and stays running
  for 30 minutes of inactivity. It maintains the WoW connection
  and buffers events for CLI clients.

GAMEPLAY DATA
  spell_data_dir            Build-12340 DBC directory in account config
  navigation_data_dir       Compatible Namigator data root (map 530)
  navigation_library        Compatible Namigator shared library
  TYPESAFE_API_KEY           Jev key in daemon environment, never config
  Restart the daemon after configuration changes. See docs/manual.md.

FILES
  ~/.config/tuicraft/config.toml  Account config
  $TMPDIR/tuicraft-<uid>/sock     Daemon socket
  $TMPDIR/tuicraft-<uid>/pid     Daemon pidfile
  ~/.local/state/tuicraft/session.log  Session log`;
}
