# AI development workflow

Date: 2026-02-18

Author: Theodor Vararu

This document is entirely human-written.

It outlines my current approach for leveraging LLMs in developing `tuicraft`.

## Developing

I use `claude` from the CLI with the plugins specified in
[.claude/settings.json](../.claude/settings.json). I have a $200/mo Max
subscription and use the default model (currently: Opus 4.6), on the default
effort setting (currently: High).

A typical feature build follows this rough workflow:

```sh
$ claude
> /superpowers:using-superpowers
> (Describe the task)
> /superpowers:brainstorming
> (Answer questions)
> /superpowers:write-plan
> /superpowers:execute-plan
```

[Superpowers](https://github.com/obra/superpowers) lets you use either git worktrees or simple feature branch + subagents to carry out the tasks.

If the work involves widescale refactor, I've had good results using [the new
agent teams feature in Claude
Code](https://code.claude.com/docs/en/agent-teams).

At the end, I ask Claude to open the branch as a PR.

## Reviewing

- [ ] `claude` 3x in parallel: `/security-review`, `/review`, `/simplify`
- [ ] `mise ci` must pass
- [ ] `mise test:live` must pass
- [ ] `mise test:coverage`, must still be 100%
- [ ] `sentry-bot` comments resolved
- [ ] Human manual end to end testing, trying the TUI myself
- [ ] Human review on GitHub, reading the full output after all LLM reviews
- [ ] Final sense-check and merge

## Safeguards and improving

If I notice Claude making the same mistake over and over again, that's a good
time to revise the prompt. I've had good results with this skill:

```sh
> /claude-md-management:revise-claude-md
```

I have a hook that filters all commands Claude runs. It's a smarter version of
the default command denylist; it doesn't just block a command, but also guides
Claude to use more appropriate commands.

It looks like this currently:

```sh
#!/bin/bash
INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command')

block() {
  echo "$1" >&2
  exit 2
}

[[ "$CMD" =~ ^mise\ run\  ]] && block 'Use "mise TASK" not "mise run TASK"'
[[ "$CMD" =~ git\ .*-[cC]\  ]] && block 'Use "git" directly, cd if you must'
[[ "$CMD" =~ ^grep ]] && block 'Use the Grep tool instead of the grep command'
[[ "$CMD" =~ ^find ]] && block 'Use the Glob tool instead of the find command'
[[ "$CMD" =~ ^cat ]] && block 'Use the Read/Write/Edit tools instead of cat'
[[ "$CMD" =~ ^bun\ run\  ]] && block 'Use mise to run package.json scripts instead of bun run'
[[ "$CMD" =~ ^bunx\  ]] && block 'Use mise to run package.json scripts instead of bunx'
[[ "$CMD" =~ ^python3\ -c ]] && block 'Write scripts to tmp and run via uv instead'
[[ "$CMD" =~ ^node\ -e ]] && block 'Write scripts to tmp and run via node'
[[ "$CMD" =~ ^bun\ -e ]] && block 'Write scripts to tmp and run via bun'
[[ "$CMD" =~ ^bun\ test ]] && block 'Use mise test instead'
[[ "$CMD" =~ ^npx ]] && block 'Use mise to run package.json scripts instead of npx'
[[ "$CMD" =~ ^git\ worktree ]] && block 'Use mise worktree instead'

exit 0
```

In a nutshell, I don't like Claude using `python3`, or bypassing my `mise`
tasks. If you like the idea, ask Claude to write one for you and set it up.
