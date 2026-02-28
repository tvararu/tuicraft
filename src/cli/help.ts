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
  tuicraft read [--wait N]    Read buffered events
  tuicraft tail               Continuous event stream
  tuicraft status             Show daemon status
  tuicraft stop               Stop the daemon
  tuicraft logs               Print session log
  tuicraft skill              Print SKILL.md for AI agents
  tuicraft version            Print version and exit
  tuicraft help               Show this help

FLAGS
  -v, --version   Print version and exit
  -h, --help      Show this help
  --json          Output events as JSONL (for read, tail, chat, who)
  --wait N        Wait N seconds for events (for read and send commands)
  --daemon        Start as background daemon (internal)

SETUP FLAGS
  --account NAME  Account name (required)
  --password PASS Password (required)
  --character NAME Character name (required)
  --host HOST     Auth server hostname (default: t1)
  --port PORT     Auth server port (default: 3724)
  --language ID   Chat language code (default: 1/Orcish)
  --timeout_minutes N  Daemon idle timeout (default: 30)

INTERACTIVE COMMANDS (TUI mode)
  /s, /y, /w, /g, /p, /raid, /1, /2  Chat commands
  /r              Reply to last whisper
  /who [filter]   Who search
  /invite <name>  Invite player to group
  /kick <name>    Remove player from group
  /leave          Leave the current group
  /leader <name>  Transfer group leadership
  /accept         Accept a group invitation
  /decline        Decline a group invitation
  /friends        Show your friends list
  /friend add <n> Add a player to friends
  /friend remove  Remove a player from friends
  /tuicraft entities on|off  Toggle entity event display
  /quit           Disconnect and exit

DAEMON
  The daemon starts automatically when needed and stays running
  for 30 minutes of inactivity. It maintains the WoW connection
  and buffers events for CLI clients.

FILES
  ~/.config/tuicraft/config.toml  Account config
  $TMPDIR/tuicraft-<uid>/sock     Daemon socket
  $TMPDIR/tuicraft-<uid>/pid     Daemon pidfile
  ~/.local/state/tuicraft/session.log  Session log`;
}
