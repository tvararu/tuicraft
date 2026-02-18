# Pipe Mode

Pipe mode activates when stdin is not a TTY. No prompt, no formatting. Raw
tab-delimited lines in and out, designed for LLM tool-use and scripts.

```
mise start < commands.txt
```

## Output Format

One line per event, three tab-separated fields:

```
TYPE\tSENDER\tMESSAGE
```

### Type Labels

| Label          | Meaning                |
| -------------- | ---------------------- |
| `SAY`          | Say                    |
| `YELL`         | Yell                   |
| `WHISPER_FROM` | Incoming whisper       |
| `WHISPER_TO`   | Outgoing whisper echo  |
| `GUILD`        | Guild chat             |
| `OFFICER`      | Officer chat           |
| `PARTY`        | Party chat             |
| `PARTY_LEADER` | Party leader           |
| `RAID`         | Raid chat              |
| `RAID_LEADER`  | Raid leader            |
| `RAID_WARNING` | Raid warning           |
| `EMOTE`        | Emote                  |
| `CHANNEL`      | Channel message        |
| `SYSTEM`       | System / error message |
| `TYPE_N`       | Unknown (fallback)     |

### Examples

```
WHISPER_FROM	Xiara	Following Deity
SAY	Xi	hello
GUILD	Xiara	heading out
SYSTEM		No player named Bob is currently playing.
```

### /who Output

```
WHO	Xiara	80	MyGuild
WHO	Hemet	74
```

One line per result: `WHO\tNAME\tLEVEL\tGUILD`. Empty result:

```
WHO		0
```

## Input Format

Same slash commands as interactive mode, one command per line on stdin:

```
/w Xiara follow Deity
/s hello
/g anyone online?
/who mage
/1 looking for group
/quit
```

Plain text (no `/` prefix) is sent as say.

## Usage Examples

### One-shot command

```sh
echo '/w Xiara follow Deity' | mise start
```

### Bidirectional with named pipe

```sh
mkfifo /tmp/wow-in
mise start < /tmp/wow-in > /tmp/wow-out &
echo '/w Xiara follow Deity' > /tmp/wow-in
```

### Subprocess integration

Spawn `mise start` as a subprocess. Write commands to stdin, read events from
stdout line by line. Each line splits on `\t` into `[type, sender, message]`.
Send `/quit` to stdin for a clean shutdown.
