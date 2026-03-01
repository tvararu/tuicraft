# Session Context

## User Prompts

### Prompt 1

Implement an ignore list feature. Add /ignore <player>, /unignore <player>, /ignorelist commands. Store ignored players (case-insensitive, lowercased Set) in config file under ignoreList array. Filter out messages from ignored players in both TUI chat display and daemon read output. Create a feat/ignore-list branch from main. Use feat: prefix for commits. Run mise ci before committing. Open a PR against tvararu/tuicraft. When completely done, run: openclaw system event --text "Done: ignore li...

### Prompt 2

# Feature Development

You are helping a developer implement a new feature. Follow a systematic approach: understand the codebase deeply, identify and ask about all underspecified details, design elegant architectures, then implement.

## Core Principles

- **Ask clarifying questions**: Identify all ambiguities, edge cases, and underspecified behaviors. Ask specific, concrete questions rather than making assumptions. Wait for user answers before proceeding with implementation. Ask questions e...

