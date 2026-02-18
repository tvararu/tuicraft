export function helpText(): string {
  return `tuicraft — WoW 3.3.5a chat client

USAGE
  tuicraft                    Interactive TUI mode
  tuicraft setup [flags]      Configure account credentials
  tuicraft "message"          Send a say message (auto-starts daemon)
  tuicraft -w <name> "msg"    Whisper a player
  tuicraft -y "message"       Yell
  tuicraft -g "message"       Guild chat
  tuicraft -p "message"       Party chat
  tuicraft --who [filter]     Who query
  tuicraft read [--wait N]    Read buffered events
  tuicraft tail               Continuous event stream
  tuicraft status             Show daemon status
  tuicraft stop               Stop the daemon
  tuicraft logs               Print session log
  tuicraft help               Show this help

FLAGS
  --json          Output events as JSONL (for read, tail, chat)
  --wait N        Wait N seconds for events (for read)
  --daemon        Start as background daemon (internal)

SETUP FLAGS
  --account NAME  Account name (required)
  --password PASS Password (required)
  --character NAME Character name (required)
  --host HOST     Auth server hostname (default: t1)
  --port PORT     Auth server port (default: 3724)

DAEMON
  The daemon starts automatically when needed and stays running
  for 30 minutes of inactivity. It maintains the WoW connection
  and buffers events for CLI clients.

FILES
  ~/.config/tuicraft/config.toml  Account config
  /tmp/tuicraft-<uid>/sock        Daemon socket
  /tmp/tuicraft-<uid>/pid         Daemon pidfile
  ~/.local/state/tuicraft/session.log  Session log`;
}
