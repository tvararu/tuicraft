# Interactive TUI

tuicraft gives you a text-based WoW experience from your terminal. Connect as a
character, chat with other players, and interact with the game through slash
commands.

## Connecting

```
mise start
```

This reads your account credentials from `mise.local.toml`. To set it up:

```
cp mise.local.toml.example mise.local.toml
# edit mise.local.toml with your account details
```

You can override any setting inline:

```
mise start --character AltChar --host myserver.com --port 3724
```

## Commands

Once connected, you'll see a `> ` prompt. Type commands or plain text:

| Command                | Action                          |
| ---------------------- | ------------------------------- |
| `hello everyone`       | Say "hello everyone" (no slash) |
| `/s hello`             | Say (explicit)                  |
| `/y HELLO`             | Yell                            |
| `/w Xiara follow me`   | Whisper to Xiara                |
| `/r on my way`         | Reply to last whisper           |
| `/g anyone online?`    | Guild chat                      |
| `/p inv please`        | Party chat                      |
| `/raid pull in 10`     | Raid chat                       |
| `/1 looking for group` | Channel 1 (usually General)     |
| `/2 WTS sword`         | Channel 2 (usually Trade)       |
| `/who mage`            | Search for online players       |
| `/quit`                | Disconnect and exit             |

## Reading Messages

Incoming messages appear above your prompt:

```
[whisper from Xiara] Following Deity
[whisper to Xiara] follow me
[say] Xi: hello
[guild] Xiara: heading out
[yell] Xi: HELLO
[party] Xiara: inv
[General] Xi: anyone around?
[system] Welcome to AzerothCore
```

## Tips

- Plain text (no `/` prefix) is sent as say
- `/r` tracks the last person who whispered you
- Channel numbers (`/1`, `/2`) map to the channels you joined on login
- Ctrl+C or `/quit` to exit cleanly
- Horde characters use language 1 (Orcish) by default. Alliance characters
  should use `mise start --language 7`
