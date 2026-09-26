# Plans index

Design and plan documents, oldest first. The sole roadmap is
[../roadmap.md](../roadmap.md); nothing here is a list of tasks to execute.

- **Current**: linked from the roadmap, or the dev-factory and Pi-harness
  designs. Still read as context for active work.
- **Historical**: records a design or plan that shipped, or a one-off run
  that finished. Useful for protocol and design reasons, not for direction.
- **Superseded**: its direction was replaced by a later document, named in
  the entry.

| File | Status | Summary |
| --- | --- | --- |
| [2026-02-17-tuicraft-design.md](2026-02-17-tuicraft-design.md) | Superseded | Original headless 3.3.5a client design; its 0.x milestone sketch is replaced by the roadmap |
| [2026-02-17-tuicraft-plan.md](2026-02-17-tuicraft-plan.md) | Historical | 0.1 implementation plan: auth, world login, first chat |
| [2026-02-18-chat-design.md](2026-02-18-chat-design.md) | Historical | 0.2 design for chat, the session API and the TUI |
| [2026-02-18-chat-plan.md](2026-02-18-chat-plan.md) | Historical | 0.2 chat implementation plan |
| [2026-02-18-chat-ux-design.md](2026-02-18-chat-ux-design.md) | Historical | Chat UX fixes design |
| [2026-02-18-chat-ux-plan.md](2026-02-18-chat-ux-plan.md) | Historical | Chat UX fixes implementation plan |
| [2026-02-18-daemon-cli-design.md](2026-02-18-daemon-cli-design.md) | Historical | Single-binary daemon and CLI design |
| [2026-02-18-daemon-cli-plan.md](2026-02-18-daemon-cli-plan.md) | Historical | Daemon and CLI implementation plan |
| [2026-02-18-emotes-design.md](2026-02-18-emotes-design.md) | Historical | Text emote opcodes and events |
| [2026-02-18-party-management-design.md](2026-02-18-party-management-design.md) | Historical | Group invite, kick, leader and member stats design |
| [2026-02-18-party-management-plan.md](2026-02-18-party-management-plan.md) | Historical | Party management implementation plan |
| [2026-02-18-v5-client-side-bot-design.md](2026-02-18-v5-client-side-bot-design.md) | Superseded | Scripted priest healer bot exploration; replaced by the roadmap's Jev-driven gameplay direction |
| [2026-02-19-specify-build-fix-design.md](2026-02-19-specify-build-fix-design.md) | Historical | SPECIFY_BUILD realm-list byte skip fix design |
| [2026-02-19-specify-build-fix-plan.md](2026-02-19-specify-build-fix-plan.md) | Historical | SPECIFY_BUILD fix implementation plan |
| [2026-02-20-opcode-stubs-design.md](2026-02-20-opcode-stubs-design.md) | Historical | Stub handlers that surface unhandled opcodes |
| [2026-02-20-opcode-stubs-plan.md](2026-02-20-opcode-stubs-plan.md) | Historical | Opcode stubs implementation plan |
| [2026-02-20-tui-vision-design.md](2026-02-20-tui-vision-design.md) | Current | Top-down spatial TUI vision; the roadmap links it as design context, not a commitment |
| [2026-02-23-tail-read-conflict-design.md](2026-02-23-tail-read-conflict-design.md) | Historical | Separate event cursors for `tail` and `read` |
| [2026-02-23-tail-read-conflict-plan.md](2026-02-23-tail-read-conflict-plan.md) | Historical | Tail/read conflict implementation plan |
| [2026-02-25-entity-parsing-design.md](2026-02-25-entity-parsing-design.md) | Historical | v0.4 SMSG_UPDATE_OBJECT entity parsing design |
| [2026-02-25-entity-parsing-plan.md](2026-02-25-entity-parsing-plan.md) | Historical | Entity parsing implementation plan |
| [2026-02-28-friend-list-design.md](2026-02-28-friend-list-design.md) | Historical | Friends list design |
| [2026-02-28-friend-list-plan.md](2026-02-28-friend-list-plan.md) | Historical | Friends list implementation plan |
| [2026-03-01-file-split-design.md](2026-03-01-file-split-design.md) | Historical | Split `client.ts` and `tui.ts` into smaller modules |
| [2026-03-01-file-split-plan.md](2026-03-01-file-split-plan.md) | Historical | File split implementation plan |
| [2026-03-01-ignore-list-design.md](2026-03-01-ignore-list-design.md) | Historical | Ignore list design |
| [2026-03-01-ignore-list-plan.md](2026-03-01-ignore-list-plan.md) | Historical | Ignore list implementation plan |
| [2026-03-01-server-broadcast-design.md](2026-03-01-server-broadcast-design.md) | Historical | Server broadcast message display design |
| [2026-03-01-server-broadcast-plan.md](2026-03-01-server-broadcast-plan.md) | Historical | Server broadcast implementation plan |
| [2026-03-03-duel-accept-decline-design.md](2026-03-03-duel-accept-decline-design.md) | Historical | Duel events and accept/decline design |
| [2026-03-03-duel-accept-decline-plan.md](2026-03-03-duel-accept-decline-plan.md) | Historical | Duel accept/decline implementation plan |
| [2026-03-03-guild-events-design.md](2026-03-03-guild-events-design.md) | Historical | Guild event display design |
| [2026-03-03-guild-events-plan.md](2026-03-03-guild-events-plan.md) | Historical | Guild events implementation plan |
| [2026-03-03-mail-notifications-design.md](2026-03-03-mail-notifications-design.md) | Historical | New-mail notification design |
| [2026-03-03-mail-notifications-plan.md](2026-03-03-mail-notifications-plan.md) | Historical | Mail notifications implementation plan |
| [2026-03-04-guild-management-design.md](2026-03-04-guild-management-design.md) | Historical | Guild management commands design |
| [2026-03-04-guild-management-plan.md](2026-03-04-guild-management-plan.md) | Historical | Guild management implementation plan |
| [2026-09-21-fault-paths-live-plan.md](2026-09-21-fault-paths-live-plan.md) | Current | Milestone 1 live-server evidence plan for fault paths; linked from the roadmap |
| [2026-09-21-m2-encounter-context.md](2026-09-21-m2-encounter-context.md) | Current | Milestone 2 encounter decisions and reasons; linked from the roadmap |
| [2026-09-21-m3-tactical-movement-design.md](2026-09-21-m3-tactical-movement-design.md) | Current | Milestone 3 movement as a tactical action; linked from the roadmap |
| [2026-09-22-m4-encounter-cycles-design.md](2026-09-22-m4-encounter-cycles-design.md) | Current | Milestone 4 repeatable encounter cycles design; linked from the roadmap |
| [2026-09-22-m4-encounter-cycles-plan.md](2026-09-22-m4-encounter-cycles-plan.md) | Current | Milestone 4 implementation plan; linked from the roadmap |
| [2026-09-22-uniform-output-envelope-design.md](2026-09-22-uniform-output-envelope-design.md) | Historical | Five-field `--json` envelope design; implemented |
| [2026-09-22-uniform-output-envelope-plan.md](2026-09-22-uniform-output-envelope-plan.md) | Historical | JSON envelope implementation plan; implemented |
| [2026-09-24-pattern-charter.md](2026-09-24-pattern-charter.md) | Historical | Target code shape for the one-time post-roadmap review |
| [2026-09-24-post-roadmap-review-design.md](2026-09-24-post-roadmap-review-design.md) | Historical | One-time review-and-refactor run over `009434b..9c47b07` |
| [2026-09-25-dev-factory-design.md](2026-09-25-dev-factory-design.md) | Current | Dev factory: issue-driven workers, reviewers, merger and reaper |
| [2026-09-25-dev-factory-research.md](2026-09-25-dev-factory-research.md) | Historical | Verbatim research reports behind the dev factory design |
| [2026-09-25-pi-harness-design.md](2026-09-25-pi-harness-design.md) | Current | Embed the Pi agent runtime in tuicraft; linked from the roadmap |
| [2026-09-25-pi-harness-spike/](2026-09-25-pi-harness-spike/README.md) | Current | Throwaway prototype code referenced by the Pi harness design |

The factory lands each pull request as one squash commit.
Squash commits carry Refs, PR and Co-authored-by trailers.
