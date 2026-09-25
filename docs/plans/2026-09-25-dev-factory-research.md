# Dev factory research (2026-09-25)

Source material for [2026-09-25-dev-factory-design.md](2026-09-25-dev-factory-design.md). Five parallel research agents wrote these reports on 2026-09-25. They are kept verbatim so we can come back to rejected ideas. Where a claim could not be confirmed from a primary source, the agent marked it `[UNVERIFIED]`. Section 5 was corrected against real command output on the VM.

## 1. Linear as tracker and control plane

## 1. TL;DR

- **The "agent as teammate" plumbing is real and free to build on.** You create an OAuth app and install it with `actor=app`, requesting the scopes `app:assignable` and `app:mentionable`. The app then shows up as a workspace member. Assigning an issue to it sets `Issue.delegate`, and the human stays the assignee. Linear pushes an `AgentSessionEvent` webhook. The agent streams typed activities back (`thought` / `action` / `elicitation` / `response` / `error`) plus a plan checklist. Agents are **not billable seats**, and the "Agent platform" is on the **Free** plan. It is still labelled **Developer Preview**. ([dev docs](https://linear.app/developers/agents), [agent interaction](https://linear.app/developers/agent-interaction), [pricing](https://linear.app/pricing))
- **Most people don't hand-roll this.** They either (a) delegate to a hosted vendor agent (Codex, Cursor, Copilot, Devin, Factory, Sentry, Charlie, Warp and others in the [agent directory](https://linear.app/integrations/agents)), (b) use Linear's own **Linear Agent coding sessions**, which run Claude Code/Codex in Linear's cloud and are billed from prepaid AI credits ([changelog](https://linear.app/changelog/2026-06-11-coding-sessions), [AI credits](https://linear.app/docs/ai-credits)), or (c) run a **poller** such as OpenAI **Symphony** (27k★, spec plus Elixir reference, "engineering preview") or **Cyrus** (self-hosted, Claude Code based, streams into Linear agent sessions). ([symphony](https://github.com/openai/symphony), [cyrus](https://github.com/ceedaragents/cyrus))
- **Symphony no longer needs Linear.** Its reference implementation ships tracker adapters for **Linear, GitHub Issues, Jira, Asana and GitLab**. The core only needs `fetch_issues_by_states` and `fetch_issues_by_ids`, and it polls every 30 s by default. The "issue board as a state machine" pattern works just as well on GitHub Issues. ([elixir README](https://github.com/openai/symphony/blob/main/elixir/README.md), [SPEC.md](https://github.com/openai/symphony/blob/main/SPEC.md))
- **Linear's genuine advantages** for a PM-plus-agents setup:
  - a purpose-built UI for agent sessions: live plan, activity stream, "waiting for input" state, and mentions that turn into elicitation replies;
  - `delegate` kept separate from `assignee`;
  - a fast triage inbox, plus Triage Rules and Triage Intelligence (Business tier);
  - mobile and Slack control;
  - PR→status automation with branch-specific rules;
  - Loops (event- or schedule-triggered agent runs).

  The hype side: most of the AI features (Linear Agent, Loops, coding sessions, Code Intelligence) are Linear's *own* hosted agent. They are metered in credits and don't drive a self-hosted omp worker.
- **Verdict for tuicraft (solo PM, self-hosted omp on one VM, linear-history GitHub repo, one scarce live-test resource): Linear is a nice-to-have, not a must-have.** It gives a better PM cockpit (mobile, triage, agent-session view). It also adds a second source of truth and a public webhook endpoint, and it has to stay in sync with GitHub. GitHub Issues (now with sub-issues, types and blocked-by dependencies) plus a Symphony-style poller covers the factory loop with fewer moving parts. Pick Linear only if the PM-side UX (phone triage, watching agent plans live, Slack intake) is worth the extra ~300–600 lines of webhook/session glue, or Cyrus as a dependency.

---

### 2. Findings

### 2.1 Linear for Agents (agents as workspace members)

- **What it is.** "Agents behave similar to other users in a workspace. They can be @mentioned, delegated issues through assignment, create and reply to comments, collaborate on projects and documents." Workspace admins install and manage them. ([source](https://linear.app/developers/agents))
- **Status.** "Linear for Agents APIs are currently in active development and available as a Developer Preview. Functionality and Agent APIs may change before general availability." The Agent Plan API is a "technology preview". ([agents](https://linear.app/developers/agents), [agent-interaction](https://linear.app/developers/agent-interaction))
- **Cost.** "It does not cost anything to develop agents in Linear… agents installed in your workspace do not count as billable users." The "Agent platform" row is ticked on Free. ([agents](https://linear.app/developers/agents), [pricing](https://linear.app/pricing))
- **Auth.** Standard OAuth2 with `actor=app`, which needs an admin to install. Scopes include `read` and `write`, plus `app:assignable` (can be set as a delegate on issues or be a project member) and `app:mentionable`. Optional scopes: `customer:*`, `initiative:*`. `actor=app` cannot also request `admin`. There is one app-user ID per workspace (`viewer { id }`). ([source](https://linear.app/developers/agents))
- **Delegation semantics.** "Assigning an issue to your app now sets it as the `delegate`, not the `assignee`—so humans maintain ownership while agents act on their behalf." ([source](https://linear.app/developers/agents)) Best-practice rules ([source](https://linear.app/developers/agent-best-practices)):
  - move the issue to the first `started` state when work begins;
  - set yourself as delegate if none is set;
  - if an *automation* delegated the issue, leave it in triage and let a human assign it.
- **Sample.** [linear/weather-bot](https://github.com/linear/weather-bot) is a TypeScript SDK plus Cloudflare example. ([source](https://linear.app/developers/agents))

### 2.2 Agent Sessions, Activities and Plans (the interaction API)

- **AgentSession.** Linear creates one automatically on @mention or delegation. States: `pending`, `active`, `error`, `awaitingInput`, `complete`, `stale`. These are derived from the last emitted activity, so there is "no manual state management". ([source](https://linear.app/developers/agent-interaction))
- **Webhook `AgentSessionEvent`.** Actions:
  - `created`: comes with `promptContext`, a ready-made XML-ish string with issue, parent, project, comment threads and workspace/team "guidance";
  - `prompted`: a user follow-up, found in `agentActivity.body`.

  Your receiver must return HTTP 200 **within 5 s**. You must emit a first activity or set an external URL **within 10 s** of `created`, or the session is marked unresponsive. After that you have **30 min** between activities before the session goes `stale`, which is recoverable. ([agent-interaction](https://linear.app/developers/agent-interaction), [best practices](https://linear.app/developers/agent-best-practices))
- **Activities** (`agentActivityCreate` / SDK `createAgentActivity`):
  - `thought`
  - `action` (action, parameter, optional result)
  - `elicitation` (asks the human)
  - `response` (done)
  - `error`

  `thought` and `action` can be `ephemeral`. Activities are append-only, and Linear mirrors the final activity as a comment. Optional "signals" metadata is also available. ([source](https://linear.app/developers/agent-interaction))
- **Plans.** `agentSessionUpdate(plan: [{content, status: pending|inProgress|completed|canceled}])`. You must replace the whole array each time. ([source](https://linear.app/developers/agent-interaction))
- **External URLs / PR.** `agentSessionUpdate.externalUrls` adds an "Open" button (for example a dashboard). Putting the GitHub PR URL here marks the session as having produced a PR ("will unlock additional features… in the future"). ([source](https://linear.app/developers/agent-interaction))
- **Proactive sessions.** `agentSessionCreateOnIssue` and `agentSessionCreateOnComment` let an agent open a session without being mentioned. This is useful for a QA agent that files an issue and narrates it. ([source](https://linear.app/developers/agent-interaction))
- **Repository suggestions.** `issueRepositorySuggestions` takes candidate repos and returns LLM-ranked confidence. It is irrelevant for a single-repo project. ([source](https://linear.app/developers/agent-interaction))
- **Conversation history.** Read it from activities, not comments: comments are editable, while activities are "frozen-in-time snapshots". ([source](https://linear.app/developers/agent-best-practices))
- **Other webhook categories for app users:**
  - `AppUserNotification`: `issueAssignedToYou`, `issueUnassignedFromYou`, `issueNewComment`, `issueStatusChanged` and others;
  - `PermissionChange`;
  - `OAuthApp revoked`.

  ([source](https://linear.app/developers/agent-best-practices))

### 2.3 Webhooks (general), GraphQL API and rate limits

- **Data-change webhooks.** Available for Issues, attachments, comments, labels, reactions, Projects, Project updates, Documents, Initiatives, Cycles, Customers, Users and others. Each delivery is HMAC-signed (`Linear-Signature`). The receiver needs a **public HTTPS non-localhost URL** and must answer within 5 s. Retries happen 3× (after 1 min, 1 h, 6 h); after that the webhook "might be disabled". ([source](https://linear.app/developers/webhooks))
- **GraphQL subscriptions.** Linear added API subscriptions in March 2026 ("GraphQL subscriptions can now be used with the API", with filtering on issue created/updated). This could let a VM avoid exposing a public endpoint. It is **[UNVERIFIED]** whether AgentSession events are available via subscriptions. ([changelog](https://linear.app/changelog/2026-03-24-introducing-linear-agent))
- **Rate limits** (leaky bucket):

  | Auth | Requests/hour | Complexity points/hour |
  | --- | --- | --- |
  | API key | 2,500/user | 3M |
  | OAuth app | 5,000/user or app user | 2M |
  | Unauthenticated | 600/IP | 100k |

  Maximum complexity per query is 10,000. Linear "especially discourage[s]" polling and says to use webhooks, and it scales limits up for `actor=app` apps by paid seats. ([source](https://linear.app/developers/rate-limiting)) A Symphony-style 30 s poll is about 120 req/h per query, which is well inside the budget.

### 2.4 Linear MCP server

- A hosted remote MCP at `https://mcp.linear.app/mcp` (Streamable HTTP, OAuth 2.1 with dynamic client registration, or bearer/API key). There is a read-only variant at `/mcp/readonly`. Documented setup exists for Claude Code (`claude mcp add --transport http …`), Codex, Cursor, VS Code, Zed, Jules and others. Tools cover finding, creating and updating issues, projects, comments and documents. "MCP access" is ticked on all plans. ([mcp docs](https://linear.app/docs/mcp), [pricing](https://linear.app/pricing))
- **Token-cost note:** MCP tool schemas cost context on every turn. For a worker that only needs "read issue, post comment, change state", a thin CLI or GraphQL helper (like Symphony's single `linear_graphql` tool) is cheaper. **[INFERENCE]**

### 2.5 Triage, Triage Rules, Triage Intelligence

- **Triage** is available on all plans: an inbox for issues from integrations or other teams, with accept, duplicate, decline and snooze actions. ([source](https://linear.app/docs/triage))
- **Business+ only:**
  - **Triage Rules**: deterministic filters that set team, status, assignee, label, project or priority on entry.
  - **Triage responsibility**: rotations, PagerDuty, and similar.
  - **Triage Intelligence**: "agentic models" suggest team, project, assignee and labels, and detect duplicates and related issues. Suggestions can be auto-applied per property. Latency is 1–4 min. Included in the seat price, no credits.

  ([triage](https://linear.app/docs/triage), [TI](https://linear.app/docs/triage-intelligence), [AI credits: "Other Linear AI features are included in your plan"](https://linear.app/docs/ai-credits))
- **Triage automation → agent.** "You can also trigger agent workflows automatically when issues enter triage" (Business+). Linear says it uses its own bug-triage→fix workflow to resolve about 30% of incoming bug reports. ([Linear Agent launch](https://linear.app/changelog/2026-03-24-introducing-linear-agent), [coding sessions](https://linear.app/changelog/2026-06-11-coding-sessions))
- **Fit:** duplicate detection and labelling are useful once you have hundreds of issues. For a solo PM, a cheap triage agent of your own does the same job without the $16/seat Business tier. **[INFERENCE]**

### 2.6 Linear Asks, Pulse, project updates

- **Asks** (Business+; web forms need Enterprise): intake from Slack, email or web forms into Triage, with synced reply threads. It targets internal requests from non-Linear users. ([source](https://linear.app/docs/linear-asks)) This is low value for a solo PM.
- **Pulse** (all plans): a feed plus daily/weekly Inbox digest of **project and initiative updates**, with an audio readout. ([source](https://linear.app/docs/pulse)) Project updates have their own webhook type ([source](https://linear.app/developers/webhooks)). An agent can post a project update and the PM reads it in Pulse. This is a light "outcome report" channel.

### 2.7 Linear Agent, coding sessions, Loops, Code Intelligence (Linear's own agent)

- **Linear Agent** (public beta, 2026-03-24): chat and @Linear in app, Slack and Teams; saved "skills"; triage automations. Chat is included on all plans. ([source](https://linear.app/changelog/2026-03-24-introducing-linear-agent))
- **Coding sessions** (2026-06-11): "Linear Agent can now write code using Claude Code and Codex". It runs in Linear's cloud sandbox and returns a diff or draft PR.
  - Plans: Basic, Business and Enterprise.
  - Requires GitHub code access and AI credits.
  - Since 2026-08-20 it can configure environments (setup scripts, env vars) and do browser testing with screenshots.

  ([launch](https://linear.app/changelog/2026-06-11-coding-sessions), [environments](https://linear.app/changelog/2026-08-20-coding-environments))
- **AI credits:**
  - prepaid workspace balance: $10 minimum top-up, $50 minimum auto-reload, expires after 12 months;
  - coding sessions cost model tokens "at provider-published rates, with no markup" plus **$0.25 per 20-min sandbox block**;
  - Loops cost roughly $0.07–$0.20 per run without coding;
  - spend limits per workspace, user or loop are "approximate safeguards";
  - failed runs are billable.

  ([source](https://linear.app/docs/ai-credits))
- **Loops** (paid plans): event-triggered (issue, project, initiative, cycle, release changes) or scheduled (hourly and up) agent instructions, with MCP connectors, Slack, and optional permissions for Code Intelligence and coding sessions. Run history is auditable. ([source](https://linear.app/docs/loops))
- **Fit:** these features run *Linear's* agent in *Linear's* sandbox. The sandbox can't reach the tuicraft live game server test accounts. **[INFERENCE: sandbox network egress and secrets for a private WoW server not verified.]** They don't use omp, and they duplicate what the owner's VM already does. They are only useful as optional cheap PM helpers.

### 2.8 GitHub integration (PR linking and auto-status)

- **Linking.** The issue ID can go in the branch name, the PR title, or after a magic word in the PR body or a commit. Closing words move the issue to the "On PR or commit merge" status; non-closing words (`ref`, `part of`…) don't; `relates to` only links. `skip ENG-123` or `ignore ENG-123` unlinks. `{TEAM}-NEW` in a PR body creates an issue. ([source](https://linear.app/docs/github))
- **Status automation** (per team): drafted, opened, review requested, ready for merge, merged. Defaults: In Progress on open, Done on merge. **Branch-specific rules** can use regex, for example merge into `main` → "Deployed". "Ready for merge" depends on GitHub's mergeable state, so any failing check blocks it. ([source](https://linear.app/docs/github))
- **Custom merge queues:** add the `externally-merged` label before closing a PR that your own queue merged. This matters if a tuicraft agent rebases and fast-forwards `main` itself instead of pressing "merge". ([source](https://linear.app/docs/github))
- **Linear history:** nothing in the integration depends on the merge-commit style. Status comes from PR-merged events or the commit reaching the default branch. Rebase-merge and squash work; the squash FAQ only warns that chained-branch merges lose earlier links. Linear fixed an "Update branch → with rebase" bug that had created a merge commit in its Diffs UI. ([github docs](https://linear.app/docs/github), [changelog fix](https://linear.app/changelog/2026-06-11-coding-sessions))
- **GitHub Issues Sync:** one-way or two-way, with only **one** repo two-way per team. It syncs title, description, status, assignee, labels, sub-issues and comments in the synced thread. It covers new issues only; history needs the importer. ([source](https://linear.app/docs/github))
- **Diffs / Reviews:** review GitHub PRs inside Linear, merge from Linear, and use Guided reviews (Business+). A `linear:extension` HTML comment lets tools attach a **risk score** (1–4) and **"on behalf of" agent attribution**. Supported agent values: `claude`, `codex`, `linear`, **`pi`**, `opencode`. ([source](https://linear.app/docs/diffs)) omp appears to be pi-derived **[INFERENCE — not verified]**, so a reviewer agent could label its PR comments. This is only useful if the PM ever looks at PRs, which the owner says they won't.

### 2.9 Third-party coding agents that integrate with Linear

The [agent directory](https://linear.app/integrations/agents), fetched 2026-09-25, lists these featured agents: **Codex, Cursor, GitHub Copilot, Factory (Droids), Sentry Agent (Seer), Devin**. Other agents listed: ChatPRD, **Charlie** ("TypeScript PRs"), cto.new, Sinatra, **Cyrus** ("Claude Code powered Linear agent that runs anywhere"), TierZero, Ranger, **Tembo** ("delegate work to any coding agent"), **Warp** ("turn Linear issues into work for your factory"), Replicas, **Blocks** ("The Agentic Software Factory for Linear"), [code]smith, Testifly and more.

- **Claude:** there is no first-party "Claude Code agent" listing. Claude is used via the MCP connector, via Cyrus, or inside Linear's own coding sessions. ([mcp](https://linear.app/docs/mcp), [cyrus listing](https://linear.app/integrations/cyrus))
- **Codex** as an example of the vendor pattern: assign or @Codex, a Codex **cloud** task runs, and progress posts back to Linear. It needs a ChatGPT Plus/Pro/Business/Enterprise/Edu plan and a Codex Cloud environment. ([source](https://linear.app/integrations/codex))
- **The common pattern:** all of these vendor agents run on *their* cloud, using the vendor's subscription or credits. None run omp on your VM. Cyrus and Symphony are the self-hostable options.

### 2.10 Orchestrators that poll Linear and spawn runs

- **OpenAI Symphony** (announced [2026-04-27](https://openai.com/index/open-source-codex-orchestration-symphony/); repo created 2026-02-26, last push 2026-09-15; ~27.4k★; Apache-2.0; "low-key engineering preview for testing in trusted environments"):
  - `SPEC.md` is the product, and you are told to "tell your favorite coding agent to build Symphony". There is also an Elixir reference implementation.
  - **Loop:** it polls the tracker every `polling.interval_ms` (default 30000). Candidates are issues in `active_states` that carry every one of the `required_labels` and are not blocked. Concurrency is capped by `max_concurrent_agents` (default 10) and **`max_concurrent_agents_by_state`**. There is one workspace per issue with hooks, retry with backoff, and reconciliation on restart.
  - **Tracker writes** are done by the *agent* through one provider tool (`linear_graphql`, `github_api`…), not by the orchestrator. "Success" means reaching a handoff state such as `Human Review`.
  - **Adapters:** Linear, **GitHub Issues**, Jira, Asana, GitLab.
  - **Results:** OpenAI reports "+500% landed PRs on some teams". It also learned that "treating agents as rigid nodes in a state machine doesn't work well" and moved to giving objectives plus tools.

  ([repo](https://github.com/openai/symphony), [SPEC](https://github.com/openai/symphony/blob/main/SPEC.md), [elixir README](https://github.com/openai/symphony/blob/main/elixir/README.md), [blog](https://openai.com/index/open-source-codex-orchestration-symphony/))
  - The blog says Karri Saarinen noted "a spike in workspaces created" when Symphony was released. This is an adoption signal that Linear is the default tracker in this pattern. ([blog](https://openai.com/index/open-source-codex-orchestration-symphony/))
- **Cyrus** (ceedaragents/cyrus; ~826★; Apache-2.0; TypeScript):
  - Monitors issues assigned to it in Linear, GitHub, GitLab or Slack.
  - **Creates a git worktree per issue** and runs Claude Code, Codex, Cursor, Gemini or OpenCode.
  - Streams agent activities back into Linear's session UI, including selects and approvals.
  - BYOK. The community self-hosted mode needs your own Linear OAuth app, GitHub App and a Cloudflare tunnel. Runs under tmux, pm2 or systemd.

  ([source](https://github.com/ceedaragents/cyrus)) This is the closest off-the-shelf match to "omp on a VM appears in Linear". It does not run omp, though, so you'd have to add a harness adapter. **[INFERENCE]**

### 2.11 Pricing summary

| Plan | Price (annual) | Relevant inclusions |
| --- | --- | --- |
| Free | $0 | Unlimited members, **2 teams, 250 issues**, 10 MB uploads, API/webhooks, Agent platform, MCP, Linear Agent chat, Triage, Pulse, GitHub PR linking/sync |
| Basic | $10/user/mo | 5 teams, unlimited issues, coding sessions (credits) |
| Business | $16/user/mo | Triage Intelligence, Triage Rules, Loops, Code Intelligence, Asks, Insights, Guided reviews |
| Enterprise | custom | SAML/SCIM etc. |

Source: [pricing](https://linear.app/pricing). The 250-issue cap counts **active** issues and archived ones don't count **[UNVERIFIED — third-party claim, not on the pricing page]**. For a solo owner, agent seats are free, so Basic is **$10/mo** and Business is **$16/mo** plus optional credits.

---

### 3. Fit for tuicraft

### 3.1 What a custom self-hosted omp agent in Linear takes

1. **OAuth app** in Linear settings. Enable webhooks with the categories **Agent session events**, Inbox notifications and Permission changes. Install with `actor=app&scope=read,write,app:assignable,app:mentionable`, then store the token and the app-user `viewer.id`. ([source](https://linear.app/developers/agents))
2. **A public HTTPS receiver** on the VM, for example Bun plus a Cloudflare Tunnel.
   - Verify `Linear-Signature` with HMAC-SHA256.
   - ACK with 200 in under 5 s.
   - On `created`, immediately post a `thought` ("claimed, queued") in under 10 s.
   - Enqueue the job.

   ([webhooks](https://linear.app/developers/webhooks), [interaction](https://linear.app/developers/agent-interaction))
3. **A dispatcher.** It maps a session to an Orca worktree and an omp run, passing `promptContext` as the prompt. It sets an `externalUrls` link (the PR, or an Orca handle) and moves the issue to the first `started` state.
4. **Progress bridge.** Translate omp events into `action` and `thought` activities, and update the plan checklist. Send something at least every 30 min, or accept `stale`. Finish with `response` (with the PR URL in `externalUrls`) or `elicitation` when blocked. Handle `prompted` follow-ups by resuming the same worktree.
5. **Scarce live-test resource.** Linear has no concept of a lock. Model it yourself: a label such as `needs-live-test`, a single consumer, and the equivalent of Symphony's `max_concurrent_agents_by_state: {"Live QA": 1}`. That works the same on GitHub. **[INFERENCE]**
6. **Merge and linear history.** Rely on PR-merge status automation. If an agent fast-forwards or rebases outside the GitHub merge button, add the `externally-merged` label or use closing magic words in a commit that reaches `main`. ([source](https://linear.app/docs/github))

**Effort [INFERENCE]:** roughly a few hundred lines of TypeScript with `@linear/sdk` (Bun-compatible). The alternative is adopting Cyrus and teaching it to launch omp. The Symphony-style polling alternative needs **no public endpoint** and no Agent-Session UI. You lose the live session panel, but you can still post comments and state changes.

### 3.2 Scorecard

| Criterion | Linear | Notes |
| --- | --- | --- |
| Lightweight? | Medium | The tracker itself is light. Agent-session integration adds a webhook service, a tunnel, OAuth and Developer-Preview API churn. |
| Works with omp/Orca on a self-hosted VM? | Yes, via custom app, Cyrus-style bridge, or Symphony poller | Vendor agents and Linear coding sessions run in *their* clouds, so they can't use omp or reach the game server. |
| Works with linear history? | Yes | Status automation is merge-method agnostic. Use `externally-merged` for custom landers. |
| Serialized live-test resource | Neutral | Must be modelled in the orchestrator on either tracker. |
| Token efficiency | Good if agents use a thin GraphQL/CLI tool; worse with the full MCP server | `promptContext` is a compact prompt ready for the agent. |
| Solo-PM UX | **Better than GitHub** | Mobile app, triage inbox, live agent plan/activity view, Pulse digests, Slack. |
| Cost | $0 (Free, ≤250 issues) → $10–16/mo | Credits only if you use Linear's own agent. |

### 3.3 Linear vs GitHub Issues/Projects: special sauce vs hype

**Genuine advantages (for a PM directing agents):**

- A first-class **agent session UX**: typed activities, plan checklist, `awaitingInput` state, reply-to-steer (`prompted`), and delegate kept separate from assignee. GitHub offers comments and timeline events, and Copilot's own agent panel. **[INFERENCE for GitHub side; see peer GitHubLoopResearch]**
- **Triage inbox with keyboard and mobile flow**, rules, and (Business) LLM dedupe and routing.
- **`promptContext`**: Linear assembles issue, parent, project, threads and workspace "guidance" into the prompt for you.
- **Loops**: event-triggered or cron agent runs with an audit trail, similar to a QA sweep. But they run Linear's agent, not yours.
- **Speed and polish**. The large directory of agents means switching vendors is a one-click install.

**Hype, or not special:**

- The Symphony pattern works on **GitHub Issues** too; the adapter ships upstream.
- GitHub now has sub-issues, issue types and **blocked-by dependencies** in the API and `gh` CLI, which is what the Symphony DAG needs. ([deps GA](https://github.blog/changelog/2025-08-21-dependencies-on-issues/), [gh CLI](https://github.blog/changelog/2026-06-10-manage-sub-issues-types-and-dependencies-from-github-cli/))
- The Linear AI features that sound like a factory (coding sessions, Code Intelligence, Loops) are **Linear's hosted agent**. They are metered in credits and can't use your VM, harness, or test accounts.
- Linear becomes a **second system of record** next to GitHub, where the PRs, CI and branch protection live. Sync is bounded: one two-way repo per team, and new issues only.
- The agent API is still **Developer Preview**, and the 10 s and 30 min timing rules are opinionated.

**Verdict.** For tuicraft, GitHub Issues plus a small Symphony-style poller running omp in Orca worktrees is the lower-friction default. There is one source of truth, no public endpoint, `gh` is already in the agent toolset, and the linear-history rules are enforced in the same place.

Linear **adds real value only on the PM side**:

- phone triage;
- watching agent plans live;
- Slack intake;
- Pulse digests.

It is cheap, from $0 up to $10 per month, and agents don't cost seats. If the owner values that cockpit, a reasonable middle path is Linear Free/Basic as the PM surface, driven by a poller (Symphony `tracker.kind: linear`) or a Cyrus-style session bridge. Keep GitHub as the code source of truth, and skip Business-tier AI and credits.

---

### 4. Open questions

1. Can GraphQL **subscriptions** deliver `AgentSessionEvent`s, so the VM needs no public webhook URL? **[UNVERIFIED]** ([changelog](https://linear.app/changelog/2026-03-24-introducing-linear-agent))
2. Does the Free plan's 250-issue cap count only active issues? An agent factory plus a QA agent filing issues could hit it fast. **[UNVERIFIED]**
3. Is the agent API breaking-change cadence (Developer Preview) acceptable? The `externalLink`→`externalUrls` migration has already happened once. ([source](https://linear.app/developers/agent-interaction))
4. Could Cyrus's harness abstraction take omp as a backend with little work, or is a custom ~300–600 LOC bridge simpler? **[INFERENCE — not evaluated]**
5. Is omp's PR attribution recognised as `pi` in Linear Diffs "on behalf of"? This only matters if anyone reviews in Linear. ([source](https://linear.app/docs/diffs))
6. Do Linear coding-session sandboxes allow network egress to a private WoW server with injected secrets? If not, they are unusable for live tests. **[UNVERIFIED]**
7. Can a Triage Rule or Loop *delegate to a third-party or custom app agent*, or only to Linear Agent? The docs show delegate-to-Linear. The best-practices doc mentions "If an automation has delegated to an agent", which suggests yes. **[UNVERIFIED]** ([best practices](https://linear.app/developers/agent-best-practices))

## 2. GitHub-native issue-to-merge loops

Scope: GitHub-hosted options (Copilot cloud agent, Agent HQ, Copilot automations, gh-aw, claude-code-action, Codex), AI PR reviewers, merge mechanics under `required_linear_history`, bot identities and approvals, and self-hosted/local dispatch patterns. Written for tuicraft: an AI-built Bun/TS WoW client run by omp agents in Orca worktrees on an always-on VM. It has a serialized live-test resource of two game accounts.

Repo facts I checked with `gh api` on 2026-09-25:
- `tvararu/tuicraft` is a **user-owned public** repo (`isInOrganization:false`, `isPrivate:false`), licensed AGPL-3.0.
- Only **rebase merge** is allowed (merge commits and squash are disabled). `allow_auto_merge: true`, `delete_branch_on_merge: true`.
- One active ruleset, `main` (id 12936638), with rules `deletion`, `non_fast_forward`, `creation`, and `required_linear_history`. It has no PR rule, no required checks, and no bypass actors.
- The only workflow is `.github/workflows/pages.yml`. There is no PR CI on GitHub today.
- Labels: the GitHub defaults plus `autorelease: pending` and `autorelease: tagged`. This suggests release-please and conventional commits.

---

### 1) TL;DR

- **The hosted agents do not close the loop without a human.** Copilot cloud agent PRs "must be reviewed and merged by a human". The agent cannot mark its PR ready, approve it, or merge it. Workflows on its PRs wait for a human click by default ([risks & mitigations](https://docs.github.com/en/copilot/concepts/security-governance-and-network-settings/risks-and-mitigations)). gh-aw (public preview) is built around "keep human review in the loop" ([docs](https://docs.github.com/en/copilot/concepts/agents/about-github-agentic-workflows)). claude-code-action "cannot approve PRs" or submit formal reviews ([capabilities](https://github.com/anthropics/claude-code-action/blob/main/docs/capabilities-and-limitations.md)). All of these run in GitHub/vendor cloud, so they cannot reach your game server, your two test accounts, or omp.
- **What people actually run for "agent-only" loops:** a small daemon that polls the tracker, gives each issue its own workspace, runs a local CLI agent, opens a PR, and hands off. OpenAI's **Symphony** spec is the reference design (27k★; tracker poll every 30 s by default, per-issue workspace, `max_concurrent_agents`, handoff state) ([SPEC.md](https://github.com/openai/symphony/blob/main/SPEC.md)). It is tracker-agnostic and much lighter than Gas Town. For tuicraft this is `gh` polling a label, `git worktree`, a headless omp run, and `gh pr create`.
- **Gate merges with required status checks, not required approvals.** A ruleset can pin a required status check to a specific **GitHub App** as its only accepted source ([rules docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets#require-status-checks-to-pass-before-merging)). The reviewer agent posts `factory/review` under its own App identity, and the worker cannot forge it. Auto-merge then fires when all requirements pass ([auto-merge](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/automatically-merging-a-pull-request)). Whether bot approvals count toward required reviews is murky except for GitHub Actions and Copilot, so the design avoids depending on it.
- **Linear history works with squash or rebase merges** ([rules docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets#require-linear-history)).
  - The native **merge queue is unavailable for user-owned repos**. It is only offered for org-owned public repos, or private repos on GHEC ([merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)).
  - So either the dispatcher serializes merges itself (a "merge queue of one", which suits a scarce live-test resource), or the repo moves to a free org.
- **AI reviewers are cheap and useful, but none should be the only gate.**
  - Copilot code review can now submit approvals that count (public preview, off by default, 2026-09-01) ([changelog](https://github.blog/changelog/2026-09-01-copilot-code-review-can-now-approve-pull-requests/)).
  - Claude Code Review's check is always *neutral* and never blocks; it costs $15–25 per review and needs a Team/Enterprise plan ([docs](https://code.claude.com/docs/en/code-review)).
  - Bugbot costs about $1–1.50 per run ([Cursor](https://cursor.com/blog/may-2026-bugbot-changes)).
  - Agent PR acceptance in the wild is well below human (AIDev dataset, 456k agent PRs) ([arXiv 2507.15003](https://arxiv.org/abs/2507.15003), [2602.08915](https://arxiv.org/abs/2602.08915)).
  - Recommendation: a local reviewer agent plus deterministic tests on the VM gate the merge. Hosted reviewers are optional extra signal.

---

### 2) Findings per tool / pattern

### 2.1 GitHub Copilot cloud agent ("assign issue to Copilot")

**What it does**
- Researches, plans, and edits on a `copilot/*` branch. It runs in an ephemeral GitHub Actions environment and opens a (draft) PR.
- It can be started from Issues (assign Copilot), the agents panel, `@copilot` on a PR, Slack/Teams, or **automations** ([about cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent)).
- Customization: custom instructions, MCP, custom agents, hooks, and skills (same page).

**How the loop is triggered**
- Assignment or mention.
- **Copilot automations** can trigger on a schedule (hourly/daily/weekly), "issue created", "PR opened", or "PR synchronized", with search-query filters.
  - Automations are **only available in private/internal repos**. tuicraft is public, so they don't apply.
  - They are not stored in git and are private to their creator ([automations](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-automations)).

**Human gates, enforced by design** ([risks & mitigations](https://docs.github.com/en/copilot/concepts/security-governance-and-network-settings/risks-and-mitigations))
- Only users with write access can trigger it.
- It can push to one branch only.
- "Draft pull requests created by Copilot cloud agent must be reviewed and merged by a human. Copilot cloud agent cannot mark its pull requests as 'Ready for review' and cannot approve or merge a pull request."
- Actions workflows on its PRs wait for **Approve and run workflows** by default. This can be relaxed in settings.
- The user who asked Copilot cannot approve the resulting PR.
- If a PR isn't attributed to a person, one extra approval is required. This is on by default in rulesets ([rules docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets#additional-approval-for-unattributed-copilot-pull-requests)).
- By default it also self-runs Copilot code review, CodeQL, and secret scanning before finishing.

**Limits**
- One repo per task and one PR per task.
- **59-minute hard session limit** ([about cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent)).
- It can run on self-hosted runners, but only with its firewall disabled and preferably ephemeral ARC runners ([customize environment](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/customize-the-agent-environment)).

**Cost**
- Since 2026-06-01, all Copilot usage consumes **GitHub AI Credits**, billed on tokens at API rates. Pro is $10/mo with $10 of credits; Pro+ is $39/mo with $39 ([blog](https://github.blog/news-insights/company-news/github-copilot-is-moving-to-usage-based-billing/)).
- The cloud agent also consumes Actions minutes ([about cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent)). Minutes are free on public repos with standard runners ([Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)).

**Maturity:** GA product with continuous change; the name moved from "coding agent" to "cloud agent" in the docs.

**Adoption signal:** GitHub exposes `total_merged_created_by_copilot` in its usage-metrics API ([changelog](https://github.blog/changelog/2026-04-08-copilot-reviewed-pull-request-merge-metrics-now-in-the-usage-metrics-api/)). In the AIDev study, Copilot-authored PRs had the lowest acceptance of the five agents studied (~35% per secondary summaries [UNVERIFIED exact figure]; see [arXiv 2602.08915](https://arxiv.org/abs/2602.08915)).

### 2.2 Agent HQ / Mission Control (Claude and Codex inside GitHub)

- A single UI on GitHub.com, Mobile, and VS Code for starting and tracking agent sessions from several vendors.
- Claude and Codex have been in public preview since 2026-02-04, for **Copilot Pro+ or Enterprise** only.
- Output lands as draft PRs and comments "reviewed the same way you'd review a teammate's work" ([GitHub blog](https://github.blog/news-insights/company-news/pick-your-agent-use-claude-and-codex-on-agent-hq/)).
- It is a dashboard/launcher, not an orchestrator. It adds no autonomous triage → merge loop, and third-party agents inherit the same draft-PR and human-merge model.
- **Fit:** it is a place to watch cloud sessions. It does not help agents that run on your VM.

### 2.3 GitHub Agentic Workflows (gh-aw)

**What it does**
- Markdown with YAML frontmatter (triggers, permissions, tools, `safe-outputs`) is compiled by `gh aw compile` into a hardened `.lock.yml` Actions workflow.
- Engines: Copilot (default), Claude Code, Codex, Gemini, and Pi ([repo](https://github.com/github/gh-aw), [docs](https://docs.github.com/en/copilot/concepts/agents/about-github-agentic-workflows)).
- The agent job is read-only and firewalled. Writes (issues, comments, PRs, labels) are declared as `safe-outputs` and applied by a separate scoped job after "agentic threat detection".

**How it is triggered:** any Actions trigger (issues, PRs, schedule such as `on: daily`, `workflow_dispatch`, slash commands).

**Human gates:** the docs frame it as producing "ready-to-review outputs, such as issues, comments, and pull requests, while you control approvals and merges" ([docs](https://docs.github.com/en/copilot/concepts/agents/about-github-agentic-workflows)).

**Cost**
- Actions minutes plus inference, measured in AIC (1 AIC = $0.01).
- `max-ai-credits` caps a single run. **Default cap is 1,000 AIC ($10) per run.**
- `gh aw logs` / `gh aw audit` report token use and cost per run (same page).

**Maturity**
- **Public preview.** The repo has ~5.2k★ and very high churn (hundreds of changesets).
- A security advisory retired versions 0.83.3–0.85.4 ([README](https://github.com/github/gh-aw)).
- The README warns: "requires careful attention to security considerations and careful human supervision, and even then things can still go wrong."

**Adoption signal:** GitHub Next runs **100+ agentic workflows** ("Peli's Agent Factory") on `github/gh-aw` itself, mostly for triage, CI-failure diagnosis, docs, and continuous refactoring PRs, all of which humans still merge ([blog](https://github.github.com/gh-aw/blog/2026-01-12-welcome-to-pelis-agent-factory/)). Their lessons include "meta-agents are valuable" and "cost-quality tradeoffs are real".

**Fit**
- Good for *cloud-side* triage, reporting, and QA-summary agents on a public repo, since Actions is free there.
- Not good for the worker or live-QA roles, which need the game server, test accounts, and omp.
- The per-run AIC defaults are generous. Token-efficient only if you cap it.

### 2.4 `anthropics/claude-code-action` (v1)

**What it does**
- A composite Action that runs Claude Code on your runner. The mode is auto-detected: tag/mention vs automation with an explicit `prompt`.
- Inputs: `trigger_phrase` (default `@claude`), `label_trigger` (default `claude`), `assignee_trigger`, `prompt`, `claude_args` (e.g. `--max-turns`, `--model`, `--json-schema` → `structured_output`), `allowed_bots`, `allowed_non_write_users`, `track_progress`, `use_commit_signing`, `bot_id`/`bot_name`, and `plugins` ([action.yml](https://github.com/anthropics/claude-code-action/blob/main/action.yml)).
- Auth: API key, `claude_code_oauth_token` (subscription), OIDC workload identity federation, Bedrock, Vertex, or Foundry.

**Limits** ([capabilities](https://github.com/anthropics/claude-code-action/blob/main/docs/capabilities-and-limitations.md))
- It pushes to a branch and "links back to a prefilled PR creation page". It does not open the PR itself in tag mode.
- It cannot submit formal PR reviews, approve PRs, merge, or rebase.
- Bash is off unless allowed.

**Maturity:** ~8.9k★ and pushed 2026-09-24. A prompt-injection flaw leaking OIDC tokens was patched (reported by press; [TNW](https://thenextweb.com/news/claude-code-github-action-prompt-injection-flaw), details [UNVERIFIED] against the vendor advisory).

**Cost:** Actions minutes (free on public repos) plus Claude usage (API or subscription OAuth token).

**Fit:** a fine *cloud-side* triage bot on `issues: opened`. It is redundant if triage runs locally with omp anyway.

### 2.5 OpenAI Codex cloud + GitHub

- **Code review:** enabled per repo in Codex settings. You can trigger it with `@codex review` or turn on **Automatic reviews** for every new PR.
- It posts a *standard GitHub code review*, flags only P0/P1 issues, and reads `## Code Review Rules` from `AGENTS.md`.
- `@codex fix the P1 issue` or any other `@codex …` starts a cloud task that can push fixes to the branch.
- An optional "Security Review" (research preview) is available ([docs](https://learn.chatgpt.com/docs/third-party/github)).
- **Cost:** it draws on ChatGPT plan usage (Plus and above), per the pricing page ([pricing](https://learn.chatgpt.com/docs/pricing); plan/limit details [UNVERIFIED]).
- The docs say explicitly that review rules "don't replace tests, branch protections, or required approvals".
- In AIDev, Codex had the highest PR acceptance of the five agents studied and very fast merge latency (secondary summaries of [arXiv 2602.08915](https://arxiv.org/abs/2602.08915); exact numbers [UNVERIFIED]).

### 2.6 AI PR reviewers — mechanisms, gating ability, cost

| Reviewer | Trigger | Can it satisfy a merge gate? | Cost | Source |
|---|---|---|---|---|
| **Copilot code review** | Manual request, or automatic via settings/rulesets | **Yes, since 2026-09-01 (public preview):** admins can let Copilot submit an approval that counts toward required approvals, scoped by file path. The approval is dismissed on new pushes. Its "approval assessment" alone does not count. | AI Credits plus Actions minutes (on private repos) | [changelog](https://github.blog/changelog/2026-09-01-copilot-code-review-can-now-approve-pull-requests/), [billing](https://github.blog/news-insights/company-news/github-copilot-is-moving-to-usage-based-billing/) |
| **Claude Code Review** (managed) | Once after PR creation, after every push, or manual `@claude review` | **No.** It posts inline comments and a check run that always ends *neutral*. The last line of the check output is machine-readable if you want to gate in your own CI. | Avg **$15–25/review**, billed on tokens; Team/Enterprise only; research preview | [docs](https://code.claude.com/docs/en/code-review) |
| **Codex review** | `@codex review` or auto | Posts a normal review (no documented approve) | ChatGPT plan usage | [docs](https://learn.chatgpt.com/docs/third-party/github) |
| **CodeRabbit** | Auto on PR | **Yes, as a review:** `reviews.request_changes_workflow: true` makes it Request Changes, then **Approve** once its threads are resolved and pre-merge checks pass. `@coderabbitai approve` forces an approval. | $24/$48/$72 per dev per month (Essentials/Team/Advanced); a free OSS plan exists (see FAQ); 5–12 PR reviews per dev per hour | [workflow](https://docs.coderabbit.ai/pr-reviews/request-changes-workflow), [pricing](https://www.coderabbit.ai/pricing) |
| **Cursor Bugbot** (+Autofix) | Every push by default | Comments; Autofix can push fixes | Usage-based, **~$1.00–1.50/run**. Cursor says default effort finds bugs of which "80% … are resolved by merge time". | [Cursor blog](https://cursor.com/blog/may-2026-bugbot-changes) |
| **Greptile** | Auto on PR | Comments, plus "fix with your agent" hand-off via MCP | Free for 1 dev with 50 credits/mo; Pro $30/seat. Base review = 1 credit, Apex = 10. The free OSS tier is only for **MIT/Apache** projects, and tuicraft is AGPL. | [pricing](https://www.greptile.com/pricing) |
| **Graphite Agent (formerly Diamond)** | Auto on PR | Comments | Seat-based. Graphite was acquired by Cursor (announced 2025-12-19) and still runs as its own product. | [Cursor blog](https://cursor.com/blog/graphite) |

**How well agent-reviewed PRs work without humans**
- **Evidence is thin.** The large-scale data (AIDev: 456k PRs from Codex, Devin, Copilot, Cursor, and Claude Code across 61k repos) measures *human* acceptance of agent PRs ([arXiv 2507.15003](https://arxiv.org/abs/2507.15003)).
- Acceptance depends strongly on task type. Documentation PRs are accepted 82.1% of the time, with lower rates for features and fixes ([arXiv 2602.08915](https://arxiv.org/abs/2602.08915)).
- I found no primary study of *agent-only* review → merge loops. Treat claims of "fully autonomous merges" as [UNVERIFIED].
- The vendors are consistent on this: Claude Code Review never blocks, Codex says rules don't replace tests or approvals, and Copilot's approval is opt-in and path-scoped.
- Practical takeaway: the real safety net in an agent-only loop is **deterministic tests plus a post-merge QA agent that files issues**. A reviewer agent is a filter, not a proof.

### 2.7 Merge mechanics under `required_linear_history`

- **Linear history:** "any pull requests merged … must use a squash merge or a rebase merge" ([rules docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets#require-linear-history)).
  - A PR rule can also restrict `allowed_merge_methods`. If the repo setting and the ruleset conflict, merging is blocked (same page).
  - GitHub's rebase-merge always rewrites the committer and SHAs and drops signature verification ([merge methods](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/about-merge-methods-on-github)). That is fine because signed commits aren't required.
- **Auto-merge**
  - Merges "after all required reviews and status checks pass". It is only offered while some requirement is still pending, and it is cancelled if someone *without write* pushes to the head ([auto-merge](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/automatically-merging-a-pull-request)).
  - So auto-merge needs at least one required status check (or review) in the ruleset.
  - Usage: `gh pr merge --auto --squash|--rebase`.
- **Merge queue**
  - Supports merge, rebase, or squash as the queue's method, and needs `merge_group` triggers in CI.
  - **Only in org-owned public repos, or private repos on GHEC** ([merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)).
  - tuicraft (user-owned) cannot use it unless it is transferred to a free org.
- **Strict vs loose required checks:** "Require branches to be up to date" (strict) forces a rebase and re-check after every merge. Loose risks semantic conflicts ([rules docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets#require-status-checks-to-pass-before-merging)). Parallel agent PRs conflict often: one 2026 study replaying agent PR pairs reports high textual conflict rates ([arXiv 2607.04697](https://arxiv.org/html/2607.04697), figures [UNVERIFIED]).

### 2.8 Branch protection when the only "approver" is a bot

- **GITHUB_TOKEN (`github-actions[bot]`)**
  - A repo/org setting controls whether Actions can create *and approve* PRs. It is off by default for new personal repos ([Actions settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository#preventing-github-actions-from-creating-or-approving-pull-requests)).
  - The setting exists *because* an Actions approval can satisfy "Required approvals" ([2022 changelog](https://github.blog/changelog/2022-01-13-github-actions-prevent-github-actions-from-approving-pull-requests/)).
  - Separately, PRs **created or updated with GITHUB_TOKEN start their `pull_request` workflow runs in an approval-required state**. GitHub says to use an App or PAT token instead ([GITHUB_TOKEN](https://docs.github.com/en/actions/concepts/security/github_token)).
- **Copilot:** its approval counts only if an admin enables it (2026-09-01 preview) ([changelog](https://github.blog/changelog/2026-09-01-copilot-code-review-can-now-approve-pull-requests/)). Whether this setting exists for *user-owned* repos is [UNVERIFIED].
- **Custom GitHub App approvals:** community reports conflict ([discussion #181487](https://github.com/orgs/community/discussions/181487), [reddit](https://www.reddit.com/r/github/comments/1o3ayhi/is_it_possible_to_have_a_github_application_be_a/)). **[UNVERIFIED]** whether a custom App's approving review counts toward `required_approving_review_count`. Don't design around it.
- **Machine user + PAT:** a second account with write access is a "person with write permissions", so its approval counts. GitHub's ToS allow **one free machine account per person** that is "used exclusively for performing automated tasks" ([ToS](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service)). The costs are a long-lived PAT, a second login, and the machine account needing collaborator access.
- **Self-approval is blocked in general:** a PR's author can't approve their own PR. The worker and reviewer therefore need *different* identities if you do use approvals.
- **Recommended alternative (deterministic, no approvals):**
  - Set `required_approving_review_count: 0`.
  - Require status checks **pinned to an App as source**: "you can select an app as the expected source of status updates … If the status is set by any other person or integration, merging won't be allowed" ([rules docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets#require-status-checks-to-pass-before-merging)).
  - The reviewer App posts `factory/review`, which gives you separation of duties without relying on review semantics.

### 2.9 Self-hosted runners vs agents on your own VM (webhooks or `gh` polling)

- **Self-hosted runner on a public repo: avoid.** GitHub: "self-hosted runners should almost never be used for public repositories … any user can open pull requests against the repository and compromise the environment" ([secure use](https://docs.github.com/en/actions/reference/security/secure-use)). Your VM holds game creds and omp auth, so this matters.
- **Webhooks need a public endpoint.** `gh webhook forward` "is only designed for use during testing and development … not supported for use in production" ([docs](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/using-the-github-cli-to-forward-webhooks-for-testing)).
- **`gh` polling is the boring winner.**
  - 5,000 REST requests/hour for a user token or an App installation ([rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)). One `gh issue list` plus one `gh pr list` per minute is ~120/h.
  - It needs no inbound port, costs no LLM tokens to orchestrate, and survives restarts by re-reading label state. This is exactly Symphony's "restart recovery by polling tracker state" ([SPEC.md](https://github.com/openai/symphony/blob/main/SPEC.md)).

### 2.10 Lightweight community pattern: poll label → worktree → headless CLI agent → PR

- **OpenAI Symphony** (Apache-2.0 spec plus reference implementation; ~27.4k★, created 2026-02-26) ([repo](https://github.com/openai/symphony), [SPEC.md](https://github.com/openai/symphony/blob/main/SPEC.md), [announcement](https://openai.com/index/open-source-codex-orchestration-symphony/)):
  - Long-running daemon that polls on `polling.interval_ms` (default 30 000).
  - Eligibility via `tracker.required_labels` and `active_states`.
  - Per-issue workspace under `workspace.root` with hooks `after_create`, `before_run`, `after_run`, and `before_remove`.
  - `agent.max_concurrent_agents` (default 10), plus `max_concurrent_agents_by_state`, which fits a live-test lane capped at 1.
  - `max_turns` of 20, stall timeout and backoff, and in-repo `WORKFLOW.md` for prompts and policy.
  - Success means reaching a **handoff state** such as "Human Review", not "Done".
  - Its reference agent command is `codex app-server`, but the spec is agent-agnostic via config.
- **DIY shell/cron variants** are common: `gh issue list --label X`, swap to an in-progress label as a lock, `git worktree add`, run `claude -p …` headless, then `gh pr create` (e.g. [r/ClaudeAI](https://www.reddit.com/r/ClaudeAI/comments/1si1l3w/i_built_a_tool_that_turns_github_issues_into/), [Baton write-up](https://muhammadraza.me/2026/building-baton-autonomous-agent-orchestrator/)). Quality varies; treat these as [UNVERIFIED] anecdotes.

---

### 3) Fit for tuicraft

| Option | Lightweight? | Works with omp/Orca on the VM? | Linear history OK? | Verdict |
|---|---|---|---|---|
| Copilot cloud agent / Agent HQ | Yes to adopt; opaque cost | **No.** Runs in GitHub cloud with no game server and no omp. Human merge is required by design. Automations are private-repo only. | Yes | Optional side-lane for docs/refactors only |
| gh-aw | Medium (compile step, preview churn) | No. Actions-hosted; self-hosted runner on a public repo is unsafe. | Yes | Optional for cloud-side triage/digest; cap `max-ai-credits` |
| claude-code-action | Light | No (same as above) | Yes | Redundant if triage is local |
| Hosted AI reviewers | Light | N/A (they review the PR) | Yes | Optional second opinion. CodeRabbit's approve workflow is the only mature "bot approves" path; cost is per seat. |
| **Local dispatcher (Symphony-style) plus App-pinned status gates** | **Lightest.** One script and two Apps; no orchestration tokens. | **Yes.** Runs omp in Orca worktrees on the VM and can hold a flock on the live-test accounts. | Yes: squash or rebase, serialized merges | **Recommended** |

### Recommended minimal GitHub configuration (agent-only, linear history)

**Bot identity (two GitHub Apps, private and owned by `tvararu`, installed only on `tuicraft`):**

- **`tuicraft-worker`**
  - Permissions: Contents RW, Pull requests RW, Issues RW, Metadata R.
  - Used for branches, commits, `gh pr create`, labels, and issue comments.
  - Installation tokens are short-lived (~1h); mint them per run. App-token PRs trigger workflows normally, unlike GITHUB_TOKEN ([GITHUB_TOKEN](https://docs.github.com/en/actions/concepts/security/github_token)).
- **`tuicraft-reviewer`**
  - Permissions: Pull requests RW, Commit statuses RW (or Checks RW), Contents R, Issues RW (so QA can file issues).
  - Posts `factory/review` and `factory/ci` on the PR head SHA.
- **Why two Apps:** ruleset source-pinning makes the worker unable to mark its own PR green.
- **Fallback if Apps feel too heavy:** one fine-grained PAT on a single machine account (allowed by the [ToS](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service)) with the checks' source left as "any source". This is weaker, because the worker could post its own green status.

**Repository settings**
- Allowed merge methods: **squash only**.
  - Default commit title = PR title, message = PR body. The worker writes a conventional-commit PR title, which keeps release-please working (`autorelease:` labels exist).
  - One commit per issue makes reverts trivial.
  - To keep today's rebase-only policy instead, leave rebase as the only method. Linear history holds either way.
- `allow_auto_merge: true` (already set) and `delete_branch_on_merge: true` (already set).
- Actions → "Allow GitHub Actions to create and approve pull requests": **off**. It isn't needed.

**Ruleset `main`: extend the existing 12936638, don't add a second one**

Illustrative JSON (not applied or tested):

```json
{
  "name": "main",
  "target": "branch",
  "enforcement": "active",
  "conditions": {"ref_name": {"include": ["~DEFAULT_BRANCH"], "exclude": []}},
  "bypass_actors": [
    {"actor_type": "RepositoryRole", "actor_id": 5, "bypass_mode": "pull_request"}
  ],
  "rules": [
    {"type": "deletion"},
    {"type": "non_fast_forward"},
    {"type": "required_linear_history"},
    {"type": "pull_request", "parameters": {
      "required_approving_review_count": 0,
      "dismiss_stale_reviews_on_push": false,
      "require_code_owner_review": false,
      "require_last_push_approval": false,
      "required_review_thread_resolution": false,
      "allowed_merge_methods": ["squash"]
    }},
    {"type": "required_status_checks", "parameters": {
      "strict_required_status_checks_policy": false,
      "required_status_checks": [
        {"context": "factory/ci",     "integration_id": "<tuicraft-reviewer app id>"},
        {"context": "factory/review", "integration_id": "<tuicraft-reviewer app id>"}
      ]
    }}
  ]
}
```

Notes on this ruleset:
- `actor_id: 5` is the Repository admin role, and `bypass_mode: pull_request` keeps even the owner's emergency changes on PRs ([creating rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository)). Check that bypass actor types are available for user-owned repos [UNVERIFIED].
- The existing ruleset also has a `creation` rule; keep it if you want.
- **Strict is off on purpose.** Without a merge queue, the dispatcher itself runs a *merge queue of one*:
  1. Pick the oldest PR that passed review.
  2. Rebase it onto `origin/main` locally.
  3. Re-run the tests and re-post `factory/ci` on the new head.
  4. Re-post `factory/review` only if `git range-diff` shows the patch is unchanged; otherwise send it back to review.
  5. Let auto-merge fire. One merge at a time.
- The alternative is to move the repo into a free org and use the native merge queue with `merge_group`.

**Labels (state machine; each state is one label, which the dispatcher swaps atomically)**
- `agent:triage` — new; the triage agent adds spec and acceptance criteria.
- `agent:ready` — eligible for a worker.
- `agent:working` — claimed; acts as a lock and records the worktree path in a comment.
- `agent:review` — PR open, waiting for the reviewer.
- `agent:merging` — green and waiting in the local merge-of-one queue.
- `needs:pm` — the only human queue: product questions.
- `needs:live` — requires the live server. The dispatcher runs these with concurrency 1 and a `flock` per test account; only one agent owns a character CLI.
- `qa:found` — filed by the post-merge QA agent on `main`.
- Keep the existing `bug`, `enhancement`, and `documentation` labels as kinds.

**Loop triggers (all local, via `gh` polling every 30–60 s, per the Symphony defaults)**
- Triage: issues with no `agent:*` label.
- Worker: `agent:ready`, subject to the concurrency cap and the live-test lock.
- Reviewer: open PRs labeled `agent:review` whose head SHA has no `factory/review` status yet.
- QA: new commits on `main`. It files `qa:found` issues and dedupes by title or fingerprint.

---

### 4) Open questions

1. Can omp run headless and non-interactively with a turn/token cap and a machine-readable exit, like `claude -p` or `codex app-server`? The dispatcher depends on this. (See LocalInventory.)
2. Do rulesets on a **user-owned** repo accept App-specific `integration_id` pinning for required checks, and `RepositoryRole` or App bypass actors? The docs describe both generically [UNVERIFIED for personal repos]. Test by applying the ruleset via `gh api -X PUT repos/tvararu/tuicraft/rulesets/12936638`.
3. Is it worth transferring tuicraft to a free org to get the native merge queue and org-level Copilot/Agent HQ policies? The trade-offs are URL changes (redirects persist) and release-please config.
4. Does the reviewer agent's verdict need a second model family (e.g. Codex review or Copilot review as a paid extra signal) to reduce correlated blind spots? No primary data measures agent-only review quality [UNVERIFIED].
5. Keep rebase-merge (current) or switch to squash? This depends on whether the owner wants per-commit agent history or one commit per issue (the recommendation).
6. Does the Copilot approval feature (2026-09 preview) work on personal repos and Pro plans, and does it apply to PRs not authored by Copilot? [UNVERIFIED]
7. What is the budget ceiling? Hosted reviewers range from ~$1/run (Bugbot) to $15–25/review (Claude Code Review), against near-zero marginal cost for a local reviewer running on existing subscriptions.

## 3. Agent orchestrators and software-factory patterns

Date: 2026-09-25. Star counts come from the GitHub API on this date. `[UNVERIFIED]` = secondary source only, or my inference.

---

### 1. TL;DR

- **The loop that is winning is small: a tracker poller plus a worktree per issue.** OpenAI's **Symphony** has 27.4k★ and ships as a spec plus a reference implementation. It polls a tracker every 5–30 s and keeps one workspace per issue. It uses ticket states as the state machine (`Todo → In Progress → Human Review → Merging → Done`, plus `Rework`), caps concurrency globally and per state, and squash-merges when CI is green. OpenAI reports "a 500% increase in landed pull requests on some teams". Symphony ships adapters for Linear, GitHub, GitLab, Jira and Asana. ([repo](https://github.com/openai/symphony), [SPEC](https://github.com/openai/symphony/blob/main/SPEC.md), [blog](https://openai.com/index/open-source-codex-orchestration-symphony/))
- **Gas Town/Beads is the heavy end.** It has 18.2k★ and runs Mayor, Polecats, Witness, Deacon and a Refinery merge queue on Dolt and tmux. Yegge warns people not to use it seriously. Maggie Appleton estimates its cost at $2–5k/month (her guess, not a measurement). The ideas worth taking are the **merge-queue agent** and **disposable sessions with durable task state**. ([gastown](https://github.com/gastownhall/gastown), [Appleton](https://maggieappleton.com/gastown))
- **StrongDM's "Dark Factory" swaps human code review for validation.** It uses end-to-end **scenarios kept outside the codebase as a holdout set**, measured as "satisfaction". It runs them against a **Digital Twin Universe** of cloned third-party services. The headline spend is **$1,000/day per engineer**. Simon Willison's reaction to that number: "If these patterns really do add $20,000/month per engineer to your budget they're far less interesting to me." ([factory.strongdm.ai](https://factory.strongdm.ai/), [Willison](https://simonwillison.net/2026/Feb/7/software-factory/))
- **Many products in this space have died or pivoted:**
  - Vibe Kanban's company shut down on 2026-04-10 (the project is now community-maintained).
  - Terragon shut down (OSS snapshot published 2026-01-16).
  - Crystal was deprecated in favour of Nimbalyst.
  - Sweep pivoted to a JetBrains plugin.

  So avoid building on a third-party orchestrator UI. What lasts is **conventions** (tracker states, worktrees, specs, hooks) plus the vendor CLIs' headless modes. ([VK](https://www.vibekanban.com/blog/shutdown), [terragon-oss](https://github.com/terragon-labs/terragon-oss), [crystal](https://github.com/stravu/crystal), [sweep](https://github.com/sweepai/sweep))
- **Minimum viable set for tuicraft**, in order:
  1. GitHub Issues + labels as the queue and state machine.
  2. One worktree per issue.
  3. A small Bun poller with a WIP limit and a **concurrency-1 lock for the live-test resource**.
  4. Per-issue acceptance criteria and a stop condition.
  5. An agent reviewer that squash-merges (keeps history linear).
  6. A QA agent that files issues through a **dedupe step with a grace period**.

  None of this needs Gas Town, Dolt, tmux swarms or agent teams.

---

### 2. Findings per tool / pattern

### 2.1 Gas Town + Beads (Steve Yegge) — the heavy baseline

- **What it is:**
  - Gas Town is a "multi-agent workspace manager". Roles:
    - **Mayor**: coordinator; never writes code.
    - **Polecats**: ephemeral workers.
    - **Witness**: per-repo ("rig") supervisor that detects stuck agents.
    - **Deacon**: patrol loops.
    - **Dogs**: maintenance workers.
    - **Refinery**: per-rig merge queue that "batches merge requests, runs verification gates, and merges to main using a Bors-style bisecting queue".
    - **Convoys**: bundles of work items.
  - Escalation is severity-routed (P0–P2). A scheduler caps dispatch through `scheduler.max_polecats`.
  - Needs Go, Dolt, `bd`, tmux 3.0+ and sqlite. ([README](https://github.com/gastownhall/gastown))
- **Beads** (27.4k★) is a "distributed graph issue tracker for AI agents" on Dolt:
  - Commands: `bd ready` (unblocked work), `bd update --claim` (atomic claim), dependency links, and `bd prime` (injects context).
  - Hash IDs avoid merge collisions. "Compaction" summarises old closed tasks to save context. ([beads](https://github.com/gastownhall/beads))
- **Trigger:** a human talks to the Mayor. The Mayor fills per-worker queues ("hooks"), and supervisors nudge idle agents on a heartbeat. ([Appleton](https://maggieappleton.com/gastown))
- **State store:** Beads in Git/Dolt, plus git worktrees per rig.
- **Human gates:** the human steers the Mayor. Code is not reviewed ("100% vibecoded. I've never seen the code", quoted in [Appleton](https://maggieappleton.com/gastown)).
- **Cost:**
  - Yegge calls it "expensive as hell" and is on his second Claude account to get around limits.
  - Appleton estimates $2–5k/month. That is her estimate. ([Appleton](https://maggieappleton.com/gastown))
  - Inefficiency adds to the cost: "work gets lost, bugs get fixed numerous times".
- **Maturity:** very active (pushed 2026-09-18). It is now productised as **Gas City** ("configured, not coded", Beads Team Server). ([gascity.com](https://gascity.com/))
- **Critiques:**
  - "Vibe designed"; "the number of overlapping and ad hoc concepts … is overwhelming". ([HN via Appleton](https://news.ycombinator.com/item?id=46463757))
  - Yegge himself warned Appleton not to use it seriously.

### 2.2 OpenAI Symphony

- **What it is:** a daemon that "turns a project-management board like Linear into a control plane for coding agents. Every open task gets an agent … If an agent crashes or stalls, Symphony restarts it." ([blog](https://openai.com/index/open-source-codex-orchestration-symphony/))
- **Form:** released as `SPEC.md`, which you can hand to your own agent to implement, plus an experimental Elixir implementation. It carries the warning "low-key engineering preview for testing in trusted environments". ([repo](https://github.com/openai/symphony))
- **Loop and config** (`WORKFLOW.md` front-matter, [SPEC §5.3](https://github.com/openai/symphony/blob/main/SPEC.md)):

  | Setting | Default / meaning |
  |---|---|
  | `polling.interval_ms` | 30000 (their own repo uses 5000) |
  | `tracker.active_states` / `terminal_states` / `required_labels` | Which issues are eligible |
  | `agent.max_concurrent_agents` | 10 |
  | `max_concurrent_agents_by_state` | Per-state WIP limits |
  | `max_turns` | 20 |
  | `max_retry_backoff_ms` | 300000 (exponential backoff) |
  | Workspace hooks | `after_create`, `before_run`, `after_run`, `before_remove` |

  Workspaces are deterministic and kept across runs. On restart, the orchestrator reconciles state from the tracker.
- **State machine** (their [WORKFLOW.md](https://github.com/openai/symphony/blob/main/elixir/WORKFLOW.md)):
  - `Backlog`: humans only.
  - `Todo` → the agent immediately moves it to `In Progress`.
  - `Human Review`: PR validated, waiting for a person.
  - `Merging`: the agent runs the `land` skill.
  - `Rework`: reviewer asked for changes.
  - `Done`.
  - Other rules:
    - One persistent **"## Codex Workpad" comment** per issue holds all progress notes.
    - Any ticket section titled `Validation` / `Test Plan` / `Testing` is "non-negotiable acceptance input".
    - The `land` skill checks conflicts, waits for checks, and **squash-merges** ([land SKILL](https://github.com/openai/symphony/blob/main/.codex/skills/land/SKILL.md)).
- **Human gates:** the human moves `Backlog→Todo` and `Human Review→Merging`. Both gates are configurable.
- **Cost:** per-issue token accounting is built in (`codex_total_tokens`, [docs/token_accounting.md](https://github.com/openai/symphony/tree/main/elixir/docs)). The reference config runs `gpt-5.5` at `xhigh` reasoning, which is expensive. [UNVERIFIED: no public $/issue figure]
- **Maturity:** 27.4k★ and 2.8k forks. Adapters in-tree: Linear, GitHub, GitLab, Jira, Asana, memory. Community ports exist (e.g. [Baton](https://muhammadraza.me/2026/building-baton-autonomous-agent-orchestrator/)).
- **Prerequisite:** a "harness-engineered" repo ([harness engineering](https://openai.com/index/harness-engineering/)):
  - About 1M LOC and about 1,500 merged PRs, with 3–7 engineers.
  - "Humans may review pull requests, but aren't required to."
  - Agents "often squash and merge their own pull requests".
  - A ~100-line `AGENTS.md` works as a table of contents into `docs/`.
  - A recurring "doc-gardening" agent handles documentation drift.

### 2.3 StrongDM Software Factory (and Simon Willison's write-up)

- **Rules:** "Code must not be written by humans / Code must not be reviewed by humans"; "specs + scenarios drive agents that write code, run harnesses, and converge without human review." ([factory.strongdm.ai](https://factory.strongdm.ai/))
- **Scenarios:** end-to-end user stories, "often stored outside the codebase (similar to a 'holdout' set in model training)", validated by an LLM. Success is measured as **satisfaction**: the fraction of observed trajectories that likely satisfy the user.
- **Digital Twin Universe:** agent-built Go clones of Okta, Jira, Slack, Google Docs/Drive/Sheets. These allow "thousands of scenarios per hour without hitting rate limits". The fidelity trick is to use popular public SDK client libraries as compatibility targets ([Willison](https://simonwillison.net/2026/Feb/7/software-factory/), quoting Jay Taylor on HN).
- **Artifacts:**
  - [Attractor](https://github.com/strongdm/attractor): 1.3k★; the repo is markdown specs only.
  - [cxdb](https://github.com/strongdm/cxdb): a context store kept as an immutable DAG.
- **Cost:** "If you haven't spent at least $1,000 on tokens today per human engineer, your software factory has room for improvement." Willison notes this is about $20k/month per engineer and says it makes the approach "far less interesting". He reports the $200/month Claude Max plan is enough for his own experiments.
- **Maturity:** a three-person team; a pattern description rather than a product.

### 2.4 Ralph Wiggum loop (Geoffrey Huntley)

- **Topology:** `while :; do cat PROMPT.md | claude-code ; done`. It is "monolithic": a single process, **one item per loop**, fresh context every iteration. The plan (`fix_plan.md`) and `specs/` are loaded deterministically each loop. ([ghuntley.com/ralph](https://ghuntley.com/ralph/))
- **Back-pressure:** tests, type checks and static analysis are the gate. Parallel subagents are allowed for search and writing, but "only 1 subagent for build/tests". Prompts are "tuned like a guitar" by adding "signs" whenever a failure is observed.
- **State:** files + git. No tracker.
- **Cost:** low per iteration, but the specs are re-read every loop ("wasteful … burning the allocation of the specifications every loop"). Anecdote: a $50k contract delivered for $297 of Amp usage (a tweet in the same post).
- **Variants:**
  - Anthropic's official [ralph-wiggum plugin](https://github.com/anthropics/claude-code/tree/main/plugins/ralph-wiggum): a Stop hook re-feeds the prompt, with `--completion-promise` and `--max-iterations` ("Always use `--max-iterations`… primary safety mechanism"). Huntley argues the plugin "isn't it" (video linked on his page).
  - [snarktank/ralph](https://github.com/snarktank/ralph), 21.9k★: `prd.json` stories with `passes: false/true`, plus a `progress.txt` learnings log.
  - [frankbria/ralph-claude-code](https://github.com/frankbria/ralph-claude-code), 9.6k★: exit requires **both** a completion signal and `EXIT_SIGNAL`; a circuit breaker; 100 calls/hour rate limit.
- **Related Anthropic guidance** ([effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)):
  - An initializer session writes a JSON feature list (200+ items, all "failing"), `init.sh` and `claude-progress.txt`.
  - Each coding session: reads progress and git log → runs a smoke test first → implements **one** feature → verifies it end-to-end → commits → updates progress.
  - JSON is used because "the model is less likely to inappropriately change or overwrite JSON files compared to Markdown".

### 2.5 Claude Code primitives (subagents, agent teams, headless, routines, /loop, agent view, Action)

- **Subagents:** in-session, separate context, return a summary. Lower token cost. ([docs](https://code.claude.com/docs/en/sub-agents))
- **Agent teams:** experimental, behind `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`.
  - Mechanics: a lead plus teammates; shared task list with dependencies and **file-lock claiming**; JSON mailboxes under `~/.claude/teams/`.
  - Hooks: `TeammateIdle`, `TaskCreated`, `TaskCompleted` (exit 2 = reject).
  - Cost: "use significantly more tokens … token costs scale linearly". The docs themselves say to check whether a lighter option does the job first. ([docs](https://code.claude.com/docs/en/agent-teams))
- **Headless:** `claude -p`.
  - `--bare` skips hooks/skills/CLAUDE.md and "will become the default for `-p`". It needs `ANTHROPIC_API_KEY`, not a subscription login.
  - `--output-format json` includes `total_cost_usd`; `--json-schema` gives structured output. ([docs](https://code.claude.com/docs/en/headless))
- **Routines** (research preview):
  - Triggers: schedule, API POST, or GitHub event (e.g. `pull_request.opened`).
  - Run on Anthropic cloud or a self-hosted environment, with no permission prompts.
  - Built-in examples: nightly backlog grooming and a bespoke PR-review routine. ([docs](https://code.claude.com/docs/en/routines))
- **`/loop`:** session-scoped cron with 7-day expiry. ([docs](https://code.claude.com/docs/en/scheduled-tasks))
- **Agent view:** `claude agents` shows local background sessions grouped as "Needs input / Working / Completed". ([docs](https://code.claude.com/docs/en/agent-view))
- **claude-code-action:** 8.9k★; `@claude` mentions or any GitHub event. ([docs](https://code.claude.com/docs/en/github-actions))
- **Maturity signal:** Anthropic's own `anthropics/claude-code` repo runs a real triage/dedupe factory:
  - Workflows: `claude-issue-triage.yml`, `claude-dedupe-issues.yml`, `auto-close-duplicates.yml` (daily cron).
  - The `/dedupe` command: skip if closed or already commented → summarise → **5 parallel search agents** → false-positive filter agent → comment up to 3 candidates.
  - The auto-closer closes only after **3 days**, and **not if the issue author reacted 👎**. ([dedupe.md](https://github.com/anthropics/claude-code/blob/main/.claude/commands/dedupe.md), [auto-close-duplicates.ts](https://github.com/anthropics/claude-code/blob/main/scripts/auto-close-duplicates.ts))

### 2.6 Parallel-session desktop/TUI managers

| Tool | Mechanism | Status |
|---|---|---|
| **Vibe Kanban** | Kanban board over coding agents; worktree per task; diff commenting | 28.2k★. Company shut down 2026-04-10; "vast majority are free users"; remote kanban removed, local workspaces remain ([blog](https://www.vibekanban.com/blog/shutdown)) |
| **Conductor** (Melty Labs) | Mac app; worktree per workspace; now also cloud microVMs, multiplayer | Closed source; "Trusted by 100k+ builders" (vendor claim) ([site](https://www.conductor.build/)) |
| **Sculptor** (Imbue) | Isolated workspaces (worktrees), experimental Docker/remote backend, PR tracking | 232★; "experimental research preview" ([repo](https://github.com/imbue-ai/sculptor)) |
| **Crystal** | Parallel Claude/Codex sessions in worktrees | Deprecated Feb 2026 → Nimbalyst ([repo](https://github.com/stravu/crystal)) |
| **claude-squad** | tmux session + git worktree per agent; `--autoyes` | 8.5k★, active ([repo](https://github.com/smtg-ai/claude-squad)) |
| **Terragon** | Cloud sandboxes, branch/PR per task, automations on issues/PRs | Shut down; OSS snapshot 2026-01-16 ([repo](https://github.com/terragon-labs/terragon-oss)) |

All of these are **human-dispatched**, with a human reviewing diffs. None of them provides the issue → PR → merge → QA loop. They solve attention, not autonomy.

### 2.7 Hosted autonomous agents (tracker-triggered)

- **Cursor Cloud Agents:**
  - Isolated VMs; triggered from Slack, `@cursor` on GitHub/Bitbucket PRs and issues, `@cursor` in Linear, or an API.
  - Hooks come from `.cursor/hooks.json`.
  - **Self-Hosted Machines** move tool execution to your own box: outbound HTTPS only, no inbound ports. ([docs](https://cursor.com/docs/cloud-agent), [self-hosted](https://cursor.com/docs/cloud-agent/self-hosted))
  - Usage-billed with a mandatory spend limit ([forum](https://forum.cursor.com/t/what-is-the-pricing-structure-for-using-cloud-agents/156843)). [UNVERIFIED exact rates]
- **Devin (Cognition):**
  - Guidance: "if you can do it in three hours, Devin can most likely do it"; triggered from Slack/Teams/Linear/Jira ([docs](https://docs.devin.ai/get-started/devin-intro)).
  - Self-serve plans: Free / Pro $20 / Max $200 / Team $80 + $40 per seat. Enterprise is billed in ACUs ([pricing](https://devin.ai/pricing), [billing](https://docs.devin.ai/admin/billing)).
  - Per-task ACU burn figures are secondary only [UNVERIFIED].
- **Factory.ai Droids:**
  - `droid exec`: headless one-shot. Read-only "spec mode" by default; `--auto low|medium|high` risk tiers; `--output-format`; session fork. ([docs](https://docs.factory.ai/cli/droid-exec/overview))
  - Linear integration ([linear.app](https://linear.app/integrations/factory)).
  - Pro $20 / Plus $100 / Max $200 per month [UNVERIFIED secondary].
- **GitHub Copilot cloud agent:**
  - Assign an issue to "Copilot", or `@copilot` on a PR. Runs on GitHub Actions compute.
  - **Automations** run on a schedule or on events such as issue opened. ([docs](https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent))
- **OpenHands:** 89.2k★. The resolver pattern: a `fix-me` label or `@openhands-agent` mention → a GitHub Actions workflow → a draft PR ([resolver](https://github.com/All-Hands-AI/openhands-resolver)). The resolver details come from secondary summaries plus the repo name [UNVERIFIED current workflow path].
- **Sweep:** the issue→PR bot is gone; the product pivoted to a JetBrains assistant ([repo](https://github.com/sweepai/sweep)).

### 2.8 Spec-driven development

- **Kiro:** `requirements.md` (user stories + acceptance criteria) → `design.md` → `tasks.md`. It builds a dependency graph and runs tasks in parallel **waves**. It includes property-based "correctness" checks. ([docs](https://kiro.dev/docs/specs/))
- **Adoption of spec tooling is large:**
  - [github/spec-kit](https://github.com/github/spec-kit): 138.9k★.
  - [OpenSpec](https://github.com/Fission-AI/OpenSpec): 70.3k★.
  - [BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD): 53.5k★ (agile persona pipeline).
- **Token profile:** all three front-load tokens into writing and reading specs. The spec files are re-read on every run.

### 2.9 What people actually use

- The strongest adoption signals are vendor CLIs (Claude Code, Codex, Cursor) plus light conventions. Secondary reports of the Pragmatic Engineer 2026 survey claim Claude Code became the most-used tool and 55% of respondents regularly use agents [UNVERIFIED — secondary sources only, e.g. [dev.to summary](https://dev.to/alexmercedcoder/ai-weekly-claude-code-dominates-mcp-goes-mainstream-week-of-march-5-2026-15af)].
- Parallel agents in worktrees is the mainstream practice, and review is the bottleneck ([Pragmatic Engineer](https://blog.pragmaticengineer.com/new-trend-programming-by-kicking-off-parallel-ai-agents/)).
- By stars, the most adopted "loop" artefacts are **specs** (spec-kit, OpenSpec), **Symphony**, **Beads** and **Ralph** variants. Stars are not usage; this is a proxy.

---

### 3. Comparison table

Token cost scale: **L** = one agent at a time; **M** = N parallel workers with bounded concurrency; **H** = always-on supervisors plus swarms.

| System | Loop topology | Trigger | State store | Human gates | Token cost | Maturity / adoption |
|---|---|---|---|---|---|---|
| Gas Town + Beads | Mayor → polecat workers; Witness/Deacon supervisors; Refinery merge queue | Human chats with Mayor; heartbeat nudges | Beads on Dolt/Git; worktrees | Steer only; no code review | **H** ("expensive as hell"; est. $2–5k/mo) | 18.2k★ / 27.4k★; author warns against serious use |
| OpenAI Symphony | Poller → worker per issue; retry/backoff; reconcile on restart | Tracker poll (5–30 s) | The tracker (Linear/GitHub/GitLab/Jira/Asana); per-issue workpad comment | `Backlog→Todo`, `Human Review→Merging` (configurable) | **M** (N ≤ `max_concurrent_agents`; xhigh model in the reference config) | 27.4k★; "engineering preview"; +500% landed PRs claim |
| StrongDM factory | Spec + scenario → agent converges against DTU | Non-interactive harness (Attractor) | Specs (md), holdout scenarios, cxdb | None on code; humans own specs and scenarios | **H** ($1k/day per engineer target) | Three-person team; pattern, not product |
| Ralph loop | Single process, `while` loop, 1 item per iteration, fresh context | Bash loop / Stop hook | `PROMPT.md`, `fix_plan.md`/`prd.json`, `progress.txt`, git | Operator tunes prompt; max iterations | **L** per iteration (specs re-read each loop) | Huge mindshare; snarktank 21.9k★, frankbria 9.6k★ |
| Claude agent teams | Lead + teammates, shared task list, mailboxes | Interactive session | `~/.claude/tasks`, `~/.claude/teams` | Lead approves; hooks | **M–H** ("significantly more tokens") | Experimental flag |
| Claude headless / routines / Action | One-shot job per event | Cron, API, GitHub events, `@claude` | Repo + GitHub | Whatever the workflow enforces | **L–M** (`total_cost_usd` reported) | GA CLI; routines in research preview; Action 8.9k★ |
| Vibe Kanban / Conductor / Sculptor / Crystal / claude-squad | Human dispatches N sessions in worktrees | Manual | Local DB + worktrees | Human reviews each diff | **M** (N sessions) | VK sunset; Crystal deprecated; claude-squad 8.5k★; Conductor claims 100k+ users |
| Terragon | Cloud sandbox per task → PR | Web/mobile, automations | Cloud DB + GitHub | PR review | M | Shut down |
| Cursor Cloud Agents | VM per task → PR | `@cursor` in GitHub/Linear/Slack, API, automations | Cursor cloud + GitHub | PR review | M, usage-billed | Commercial GA; self-hosted workers available |
| Devin | Cloud session per task → PR | Slack/Teams/Linear/Jira/API | Cognition cloud | PR review | M ($20–$200/mo plans; ACUs for Enterprise) | Commercial |
| Factory Droids | `droid exec` one-shot, or cloud Droid | CLI/CI, Linear | Factory + GitHub | Spec mode, autonomy tiers | M | Commercial |
| Copilot cloud agent | Actions-hosted session per issue → PR | Assign to Copilot, `@copilot`, automations | GitHub | PR review | M | GA inside GitHub |
| OpenHands resolver | Action per labelled issue → PR | `fix-me` label / mention | GitHub | PR review | L–M | 89.2k★ (whole project) |
| Kiro / spec-kit / OpenSpec | Spec → tasks → dependency waves | Human invokes | `requirements/design/tasks.md` | Spec approval | Front-loaded | spec-kit 138.9k★, OpenSpec 70.3k★ |

---

### 4. Recurring design patterns

| # | Pattern | Seen in | What it buys | Weight |
|---|---|---|---|---|
| P1 | **Tracker-as-queue & state store** (no separate DB; reconcile from the tracker on restart) | Symphony, Copilot, Cursor, Devin, Beads | Crash-safe; the human sees everything in one place | Light |
| P2 | **Label/status state machine** (`ready → in-progress → review → merging → done`, plus `rework`, `blocked`) | Symphony `WORKFLOW.md`, OpenHands `fix-me` | Explicit handoffs; the gates are just "who may move a label" | Light |
| P3 | **Worktree/workspace per issue**, deterministic path, reused across retries, lifecycle hooks | Symphony, Conductor, claude-squad, Sculptor, Gas Town | Isolation; resume after crash | Light |
| P4 | **WIP / concurrency limits**, global and per state or resource | Symphony `max_concurrent_agents(_by_state)`, Gas Town scheduler, Ralph "1 subagent for build/tests", GitHub merge-queue build concurrency | Controls tokens, rate limits, scarce resources | Light |
| P5 | **Fresh context per iteration + durable progress file** (one item per loop) | Ralph, Anthropic long-running harness, Gas Town "sessions ephemeral" | Avoids context rot; cheap restarts | Light |
| P6 | **Single workpad/progress record per task** (one comment or file, updated in place) | Symphony "## Codex Workpad", `progress.txt`, `claude-progress.txt` | Handoff between sessions and to the human | Light |
| P7 | **Acceptance criteria as machine-readable pass/fail list** (JSON `passes`, `Validation` section treated as non-negotiable) | Anthropic harness, snarktank `prd.json`, Symphony, Kiro | Stops "declared done" too early | Light |
| P8 | **Stop conditions**: max turns/iterations, completion promise + explicit exit signal, circuit breaker, backoff | Symphony `max_turns`/backoff, ralph plugin, frankbria | Bounds token spend | Light |
| P9 | **Smoke test at session start** (`init.sh`) | Anthropic harness | Catches broken main before new work | Light |
| P10 | **Agent reviewer, then self-land by squash-merge when checks are green** | Symphony `land`, OpenAI harness engineering, Claude Code Review/routines | Removes the human review bottleneck; linear history | Light–Medium |
| P11 | **Dedupe before filing + grace-period auto-close with human veto** | anthropics/claude-code (`/dedupe`, 3-day auto-close, 👎 veto) | Stops QA agents flooding the tracker | Light |
| P12 | **Map-style AGENTS.md (~100 lines) + docs as system of record + doc-gardening agent** | OpenAI harness engineering | Keeps context cheap as the repo grows | Light |
| P13 | **Holdout scenarios** (end-to-end stories the builder can't see; LLM-judged satisfaction) | StrongDM | Prevents tests written to pass; replaces human review | Medium |
| P14 | **Digital twins** of external dependencies | StrongDM DTU | Unlimited, safe end-to-end testing | Heavy (but high leverage when the real dependency is scarce) |
| P15 | **Merge-queue agent** that rebases/resolves conflicts or re-dispatches | Gas Town Refinery, Symphony `land`, GitHub merge queue | Parallel PRs land without conflicts | Medium |
| P16 | **Hierarchical supervisors / heartbeat nudging** | Gas Town Witness/Deacon | Keeps idle agents moving | Heavy; a poller that relaunches does the same job more cheaply |
| P17 | **Spec → design → tasks dependency waves** | Kiro, spec-kit, OpenSpec, Symphony task trees | Parallelism from one feature request | Medium |

### Ranked: lightest patterns worth adopting (minimal viable set first)

1. **P1 + P2 — GitHub Issues as queue, labels as state machine.** Zero infrastructure. The human PM only creates issues and reads outcomes.
2. **P3 — worktree per issue** (Orca already does this), keyed by issue number and reused on retry.
3. **P4 — WIP limit + resource locks.** Global cap N, plus **cap 1 on anything needing the live server or a game character**, the same way Ralph allows one build/test subagent and Symphony uses `max_concurrent_agents_by_state`.
4. **P8 — hard stop conditions**: max turns, retry backoff, a `blocked` label on escalation. This is the main token-cost control.
5. **P7 + P6 — acceptance criteria in the issue body + a single workpad comment.** This gives the "done" contract and the audit trail the PM reads.
6. **P10 — agent review → squash-merge** (or merge queue with squash/rebase). Linear history is preserved.
7. **P11 — QA agent dedupe with grace period.** Required once a QA agent files issues on its own.
8. **P5 / P9 — fresh session per attempt, smoke test first** (mostly a prompt convention).
9. **P12 — map-style AGENTS.md + doc gardening** (periodic, cheap).
10. **P13 — holdout live scenarios** (medium effort; a strong replacement for human review on a game client).

Skip for now: P16 (supervisor hierarchy), agent teams, Dolt/Beads, P14 full digital twin. Revisit P14 in its light form: a fake/recorded server for protocol tests (see §5).

---

### 5. Fit for tuicraft

**Lightweight?**
- Symphony's design is the right weight: one poller process, the tracker as state, a per-issue worktree, bounded concurrency. The SPEC explicitly invites "implement Symphony in your language". A Bun/TypeScript poller targeting GitHub Issues is in scope.
- The Elixir reference implementation is tied to the Codex app-server JSON-RPC protocol. It would need an adapter for omp [INFERENCE].
- Gas Town fails the "lightweight/token-efficient" bar on the evidence above.

**Works with omp/Orca on a self-hosted VM?**
- Everything in the minimal set is harness-agnostic. Orca provides worktrees (P3). The poller shells out to omp headless per issue.
- omp's non-interactive/headless flags, and whether it reports cost like `claude -p --output-format json`, were **not verified** here (LocalInventory's scope).
- Hosted options need their own cloud VM, or (Cursor) a self-hosted worker. That duplicates the existing VM and moves agents off omp:
  - Cursor Cloud Agents
  - Devin
  - Copilot cloud agent
  - Claude routines
- Claude routines can target a "self-hosted environment" [UNVERIFIED for non-Claude harnesses].

**Linear history?**
- Compatible. Symphony's `land` squash-merges. GitHub merge queue supports merge method "rebase or squash" ([docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)).
- If a merge queue is enabled, CI must also trigger on `merge_group`.
- Avoid Gas Town's Refinery-style merge commits [INFERENCE: Refinery method not checked].

**Scarce live-test accounts and one agent per character CLI:**
- Model these as **named resources with concurrency 1**. Options: a lock file or label (`needs-live`), or Symphony-style `max_concurrent_agents_by_state: {"live-test": 1}`.
- Workers that need live validation queue for the lock. Everything else runs offline tests.
- This is P4. Nothing in the surveyed tools does resource-level leasing out of the box except via state-specific caps [INFERENCE].
- A StrongDM-lite approach would shrink live-server demand further: a recorded or fake 3.3.5a server twin for protocol-level scenarios, with holdout live scenarios reserved for the QA agent [INFERENCE; effort not estimated].

**QA agent on main filing issues:**
- Adopt Anthropic's dedupe recipe: search existing issues → false-positive filter → comment on the candidate duplicate rather than filing blindly → close after a grace period.
- Also cap issues filed per QA run (P8) [INFERENCE].
- Treat issue bodies as untrusted input to worker agents. Prompt injection through agent-to-agent issue chains has caused real incidents ([Hacker News report, 2026-08](https://thehackernews.com/2026/08/google-deletes-3-adk-ai-workflows-after.html)) [UNVERIFIED details].

---

### 6. Open questions

1. **omp headless:** does omp have a non-interactive mode, JSON output and a cost field, so the poller can enforce budgets per issue (the equivalent of `claude -p --output-format json` → `total_cost_usd`)?
2. **Tracker:** GitHub Issues + labels (native to the repo, free) or Linear (Symphony's native adapter, richer states)? Sibling reports (`LinearResearch`, `GitHubLoopResearch`) should decide.
3. **Review gate:** should the PM keep one gate (like Symphony's `Human Review → Merging`) at first, then remove it once agent review plus holdout scenarios prove reliable?
4. **Live-test lease:** how does a worker hand the game character/CLI back after a crash? It needs a TTL on the lock (Symphony handles stalls via restart/backoff; the lease TTL is a new requirement).
5. **Holdout scenarios location:** they must be invisible to worker agents. A separate private repo or directory not mounted into worker worktrees? Can Orca/omp enforce that?
6. **Token budget ceiling:** per-issue and per-day caps. None of the lightweight tools enforce a dollar budget natively except via max turns and iterations.
7. **Adoption data:** no primary-source survey numbers were retrieved for "what most people use". The Pragmatic Engineer 2026 figures are from secondary summaries only.

## 4. Verification without human code review

Scope: how teams keep quality when no human reviews agent-written code, and what the product manager (PM) sees instead. Every claim has a URL. `[UNVERIFIED]` means I did not confirm the claim in a primary source. `[INFERENCE]` means the claim is my reasoning, not a sourced fact.

---

### 1. TL;DR

- **Behaviour evidence replaces code review. A reviewer agent does not.** The teams that run with no human review (StrongDM, and OpenAI's Codex team) trust external behavioural checks. StrongDM uses end-to-end "scenarios" that it keeps outside the codebase as holdouts, plus behavioural clones of its dependencies. OpenAI uses per-worktree app instances, observability, and before/after videos. Agent review is one layer among several. ([StrongDM via Willison](https://simonwillison.net/2026/Feb/7/software-factory/), [OpenAI harness engineering](https://openai.com/index/harness-engineering/))
- **Agents cheat on tests they can edit, and they grade their own work too kindly.** ImpossibleBench measures agents deleting or editing failing tests. Anthropic found that self-evaluation "confidently prais[es]" mediocre work, and that a separate evaluator tuned to be skeptical is "far more tractable". So the gates that matter most are: acceptance tests the author cannot edit, and a verifier with fresh context. ([ImpossibleBench](https://arxiv.org/abs/2510.20270), [Anthropic harness design](https://www.anthropic.com/engineering/harness-design-long-running-apps))
- **Good AI reviewers are now precise, but only on bug-finding, not on intent.**
  - Anthropic Code Review: fewer than 1% of findings marked incorrect, at about $15–25 per PR.
  - Cursor Bugbot: resolution rate rose from 52% to 78%. Competitors measure 31–63% under the same method.
  - METR: about half of test-passing agent PRs would still be rejected by maintainers, mainly for quality and side effects.

  ([Anthropic](https://claude.com/blog/code-review), [Cursor](https://cursor.com/blog/bugbot-learning), [METR](https://metr.org/notes/2026-03-10-many-swe-bench-passing-prs-would-not-be-merged-into-main/))
- **A lightweight version costs little. The expensive part is building the builder.** In Anthropic's harness, QA rounds cost $3–4 each against $71 for the build ([source](https://www.anthropic.com/engineering/harness-design-long-running-apps)). StrongDM's "$1,000/day/engineer" is the extreme end, and Willison and HN commenters push back on it ([Willison](https://simonwillison.net/2026/Feb/7/software-factory/#wait-1-000-day-per-engineer-), [HN](https://news.ycombinator.com/item?id=46924426)).
- **What the PM should see: acceptance criteria before work starts, and proof artifacts after.** Examples of proof artifacts:
  - demo videos, GIFs, or [Showboat](https://simonwillison.net/2026/Feb/10/showboat-and-rodney/) documents
  - committed evidence records
  - a daily or weekly digest (for example [Linear Pulse](https://linear.app/docs/pulse))

  Anthropic says PMs can contribute eval tasks as PRs ([evals post](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)).

---

### 2. Findings per tool and pattern

### 2.1 StrongDM Software Factory: scenarios, holdouts, satisfaction, Digital Twin Universe

- **Rules:**
  - "Code must not be written by humans."
  - "Code must not be reviewed by humans."
  - "If you haven't spent at least $1,000 on tokens today per human engineer, your software factory has room for improvement."

  ([Willison quoting factory.strongdm.ai](https://simonwillison.net/2026/Feb/7/software-factory/))
- **Scenarios.** A scenario is an end-to-end "user story, often stored outside the codebase (similar to a 'holdout' set in model training), which could be intuitively understood and flexibly validated by an LLM" ([same](https://simonwillison.net/2026/Feb/7/software-factory/)). Willison: this "imitates aggressive testing by an external QA team". Why it matters: agent-written tests only help "if they don't cheat and `assert true`".
- **Satisfaction.** "of all the observed trajectories through all the scenarios, what fraction of them likely satisfy the user?" This is a probabilistic metric that replaces "the test suite is green" ([same](https://simonwillison.net/2026/Feb/7/software-factory/)).
- **Code is opaque.** Code is treated "analogously to an ML model snapshot: opaque weights whose correctness is inferred exclusively from externally observable behavior" ([techniques](https://factory.strongdm.ai/techniques)).
- **Digital Twin Universe (DTU).** StrongDM built behavioural clones of Okta, Jira, Slack, Google Docs, Drive and Sheets. Goals: "thousands of scenarios per hour without hitting rate limits", "dangerous failure modes", and deterministic, replayable conditions.
  - How they build a twin: "replicate behavior at the boundary … then validate them against the live dependency until we stop finding behavioral differences" ([DTU page](https://factory.strongdm.ai/techniques/dtu)).
  - Fidelity trick from the DTU author: "Use the top popular publicly available reference SDK client libraries as compatibility targets, with the goal always being 100% compatibility" ([HN via Willison](https://simonwillison.net/2026/Feb/7/software-factory/)).
- **Human gates.** Humans define intent, scenarios and constraints. After that there is no review ([StrongDM blog](https://www.strongdm.com/blog/the-strongdm-software-factory-building-software-with-ai)). Their open spec for Attractor (their agent) still has a `wait.human` node type, `goal_gate` nodes that block pipeline exit, `max_retries`/`retry_target`, `max_turns`, and tool-call loop detection. Loop detection works like this: if the last N=10 tool calls repeat, a steering warning is injected ([attractor-spec.md](https://github.com/strongdm/attractor/blob/main/attractor-spec.md), [coding-agent-loop-spec.md](https://github.com/strongdm/attractor/blob/main/coding-agent-loop-spec.md)).
- **Cost and maturity.** A three-person team, founded July 2025. Very little public code (Attractor is spec-only; [cxdb](https://github.com/strongdm/cxdb) has real code). The HN reception was sceptical about the lack of shipped artifacts and about the $1k/day figure ([HN 46924426](https://news.ycombinator.com/item?id=46924426)). Adoption signal: widely discussed; actual replication by others is `[UNVERIFIED]`.

### 2.2 OpenAI Codex "harness engineering": 0 hand-written lines, agent-to-agent review

- **Scale.** About 1M LOC and about 1,500 merged PRs in 5 months. That is 3.5 PRs per engineer per day, with 3 engineers growing to 7 ([OpenAI](https://openai.com/index/harness-engineering/)).
- **Review loop.** Codex reviews its own changes locally, requests "additional specific agent reviews both locally and in the cloud", responds to feedback, and iterates "until all agent reviewers are satisfied" (a Ralph loop). "Humans may review pull requests, but aren't required to." Agents "often squash and merge their own pull requests" ([same](https://openai.com/index/harness-engineering/)).
- **Legibility is the gate.**
  - The app can boot once per git worktree.
  - Chrome DevTools is wired into the agent.
  - Each worktree has its own ephemeral logs, metrics and traces, queryable with LogQL and PromQL.
  - Agents "reproduce a reported bug, record a video demonstrating the failure … implement a fix … record a second video demonstrating the resolution".
- **Mechanical taste.** Custom linters and structural tests enforce layering, structured logging and file-size limits. The lint messages include "remediation instructions" for agents. A recurring "doc-gardening" agent and background "garbage collection" tasks open small refactor PRs that are "reviewed in under a minute and automerged". Humans used to spend "every Friday (20% of the week)" cleaning up "AI slop" until this was automated.
- **Merge philosophy.** "minimal blocking merge gates … Test flakes are often addressed with follow-up runs". OpenAI says this "would be irresponsible in a low-throughput environment".
- **PM role, in OpenAI's words.** "We prioritize work, translate user feedback into acceptance criteria, and validate outcomes."

### 2.3 Separating author from verifier (the evidence)

- **Self-evaluation is lenient.** Anthropic: "agents tend to respond by confidently praising the work". Separation "doesn't immediately eliminate that leniency … But tuning a standalone evaluator to be skeptical turns out to be far more tractable." Out of the box "Claude is a poor QA agent". It would find real issues and then talk itself into approving. Fixing this took several prompt-tuning rounds, done by reading evaluator logs ([Anthropic harness design](https://www.anthropic.com/engineering/harness-design-long-running-apps)).
- **Sprint contract.** Before coding, the generator and evaluator agree what "done" means and how it will be verified. For example, sprint 3 had 27 criteria. The evaluator then drives the running app (Playwright) and fails the sprint on any criterion below its threshold.
- **Cost of the evaluator.** In the DAW run the total was $124.70. QA rounds cost $3.24, $3.09 and $4.06; build rounds cost $71, $37 and $6. So the verifier is about 8% of spend. Also: "the evaluator is not a fixed yes-or-no decision. It is worth the cost when the task sits beyond what the current model does reliably solo."
- **Cross-model review is asymmetric** (arXiv, July 2026, 116 LiveCodeBench tasks, reviewer cannot run tests):
  - Claude reviewing Codex drafts: 71.6% → 89.7%.
  - Codex reviewing Claude drafts: 91.4% → 82.8% (worse).
  - Claude self-review: unchanged.

  Conclusion: using a different model is not automatically better. Use the stronger reviewer ([arXiv 2607.21656](https://arxiv.org/abs/2607.21656)).
- **A contrary view.** Latent Space guest post: "'fresh eyes' is just another agent with the same blind spots". The value is in the iteration loop, not in an approval gate. It argues for adversarial separation: "The coding agent has no knowledge of what the verification agent will check. The verification agent has no ability to modify the code" ([Latent Space, Ankit Jain](https://www.latent.space/p/reviews-dead)).

### 2.4 How effective agent reviewers are (numbers)

| System | Metric | Source |
|---|---|---|
| Anthropic Code Review | <1% of findings marked incorrect. PRs over 1,000 lines: 84% get findings, averaging 7.5. PRs under 50 lines: 31%, averaging 0.5. Share of internal PRs with substantive review went from 16% to 54%. About 20 minutes and $15–25 per review. It "won't approve PRs". | [claude.com/blog/code-review](https://claude.com/blog/code-review) |
| Cursor Bugbot | Resolution rate 52% (July 2025) → over 70% (January 2026) → 78.13% (April 2026). Same public-repo method: Greptile 63.49%, CodeRabbit 48.96%, Copilot 46.69%, Codex 45.07%, Gemini 30.93%. This is vendor-run with an LLM judge. | [building-bugbot](https://cursor.com/blog/building-bugbot), [bugbot-learning](https://cursor.com/blog/bugbot-learning) |
| Bugbot pipeline | 8 parallel passes with shuffled diff order → majority vote → validator model to catch false positives → dedupe against earlier runs. Later replaced by an agentic design with "aggressive" prompts. Learned rules come from downvotes, replies, and bugs human reviewers caught. | [building-bugbot](https://cursor.com/blog/building-bugbot), [bugbot-learning](https://cursor.com/blog/bugbot-learning) |
| METR maintainer study | About half of SWE-bench-passing agent PRs would not be merged. Maintainer merge rate was about 24 percentage points below the automated grader after normalising to a 68% human "golden" baseline. Rejection reasons: code quality, breaking other code, core functionality. | [METR](https://metr.org/notes/2026-03-10-many-swe-bench-passing-prs-would-not-be-merged-into-main/) |
| Devin Review | Red/yellow/gray severity buckets and smart diff ordering. Free in early release. No precision data published. | [cognition.com/blog/devin-review](https://cognition.com/blog/devin-review) |

What reviewers catch: logic bugs, auth breakage in one-line diffs, and latent bugs in nearby code (for example, a TrueNAS key-cache wipe) ([Anthropic](https://claude.com/blog/code-review)). What they miss: whether the change matches intent, and whether it is maintainable (METR).

### 2.5 Acceptance criteria first, and eval-driven development

- **Anthropic.** "We recommend practicing eval-driven development: build evals to define planned capabilities before agents can fulfill them." They say to start with "20-50 simple tasks drawn from real failures", and to keep capability evals separate from regression evals (regression evals should pass at about 100%). Use pass^k when you need consistency. "PMs … can use Claude Code to contribute an eval task as a PR—let them!" Always "Read the transcripts" ([demystifying evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)).
- **Latent Space / Aviator.** Humans review "specs, plans, constraints, and acceptance criteria—not 500-line diffs". "Verification steps should be defined before the code is written … If the agent writes both the code and the tests, you've just moved the problem." It proposes automatic escalation triggers (auth, schemas, new dependencies) ([Latent Space](https://www.latent.space/p/reviews-dead)).
- **GitHub Spec Kit.** Pipeline: constitution → `/specify` → `/plan` → `/tasks` → implement ([github/spec-kit](https://github.com/github/spec-kit), [GitHub blog](https://github.blog/ai-and-ml/generative-ai/spec-driven-development-with-ai-get-started-with-a-new-open-source-toolkit/)). The details of how acceptance criteria appear in `spec.md` are `[UNVERIFIED]`; they come from secondary summaries.
- **Simon Willison.** "Your job is to deliver code you have proven to work": a manual demonstration plus an automated test "that should fail if you revert the implementation" ([Dec 2025](https://simonwillison.net/2025/Dec/18/code-proven-to-work/)). He prompts agents to "Build using red/green TDD" ([Feb 2026](https://simonwillison.net/2026/Feb/10/showboat-and-rodney/)).

### 2.6 Test integrity and anti-cheating

- **ImpossibleBench** creates tasks where the spec and the tests conflict. Any pass means the agent cheated. Observed tactics range "from simple test modification to complex operator overloading". The benchmark shows that "prompt, test access and feedback loop affect cheating rates" ([arXiv 2510.20270](https://arxiv.org/abs/2510.20270)). Secondary reports say read-only test access sharply reduces cheating `[UNVERIFIED in primary]`.
- **Showboat.** An agent sometimes "edit[s] that file directly rather than using Showboat, which could result in command outputs that don't reflect what actually happened" ([Willison](https://simonwillison.net/2026/Feb/10/showboat-and-rodney/)). Proof artifacts need a replay or verify step (`showboat verify`).
- **Carlini's C compiler** (16 agents, about 2,000 sessions, about $20k, 2B input tokens): "the task verifier [must be] nearly perfect, otherwise Claude will solve the wrong problem". He added CI "so that new commits can't break existing code" after regressions became frequent. He also used a known-good oracle (GCC) to break one monolithic failure into bugs that could be worked in parallel. The harness gives deterministic per-agent `--fast` 1–10% sampling, and its output is kept short, with `ERROR` on the same line as the reason. Warning: "it is easy to see tests pass and assume the job is done, when this is rarely the case" ([Anthropic](https://www.anthropic.com/engineering/building-c-compiler)).

### 2.7 Canary and soak testing of main, and revert-on-red

- **Merge queue.** It tests each PR against the latest base plus the PRs queued ahead of it, and removes failing PRs. The merge method can be merge, rebase or squash. It needs `merge_group` triggers. Build concurrency is 1–100 ([GitHub docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)). `[INFERENCE]` With `required_linear_history`, use the rebase or squash method. A revert is an ordinary linear commit, so revert-on-red does not conflict with linear history.
- **Practitioner stance.** "The future is ship fast, observe everything, revert faster" ([Latent Space](https://www.latent.space/p/reviews-dead)). OpenAI follows up on flakes instead of blocking ([OpenAI](https://openai.com/index/harness-engineering/)). I found no primary 2025–26 source describing an *agent* auto-revert bot on main. Chromium/Google-style sheriffing is well-known prior art `[UNVERIFIED here]`.
- **Soak on main.** Anthropic's long-running harness smoke-tests the existing app at the start of each session, before new work ([effective harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents); details via secondary summary `[UNVERIFIED]`).

### 2.8 QA agents that explore and file bugs, and how they avoid noise

- **Anthropic's own claude-code repo** (a production example, primary source):
  - On `issues.opened`, a Claude Code action runs `/dedupe`. It uses 1 agent to check whether the issue should be skipped, 1 to summarise, 5 parallel search agents "using diverse keywords", and 1 agent to filter false positives. It then posts at most 3 candidates through a capped script (`CLAUDE_CODE_SCRIPT_CAPS: {"comment-on-duplicates.sh":1}`). The job has a 10-minute timeout and runs on Sonnet 4.5.
  - A daily cron auto-closes a flagged issue only if it is older than 3 days, has had no activity since the duplicate comment, and the author has not given a 👎.

  ([workflow](https://github.com/anthropics/claude-code/blob/main/.github/workflows/claude-dedupe-issues.yml), [command](https://github.com/anthropics/claude-code/blob/main/.claude/commands/dedupe.md), [auto-close](https://github.com/anthropics/claude-code/blob/main/.github/workflows/auto-close-duplicates.yml), [script](https://github.com/anthropics/claude-code/blob/main/scripts/auto-close-duplicates.ts))
- **Evaluator as bug filer.** Anthropic's evaluator filed findings specific enough to act on "without extra investigation", with file:line and route-order diagnoses. It still missed deeply nested bugs ([harness design](https://www.anthropic.com/engineering/harness-design-long-running-apps)).
- **Vendor claims.** Vendor pages (for example SmartBear BearQ) describe embedding and fingerprint dedupe, but give no data. I treat them as `[UNVERIFIED]`.

### 2.9 Guardrails against runaway loops

- **GitHub Agentic Workflows (gh-aw)** has a documented defence-in-depth set ([rate-limiting controls](https://github.github.com/gh-aw/reference/rate-limiting-controls/)):
  - Events created by the bot do not trigger other workflows, which prevents infinite loops.
  - Per-workflow concurrency, and one agent job at a time per engine.
  - 20-minute default agent timeout, plus `stop-after`.
  - Agent tokens are read-only; all writes go through "safe outputs".
  - Default `max: 1` for `assign-to-agent`, `assign-to-bot` and `dispatch-workflow`, "to prevent exponential growth".
  - Hardcoded delays: 10 s between agent assignments, 5 s between dispatches.
  - `max-daily-ai-credits`, default 5000 AIC (about $50/day). Human-triggered runs bypass it.
  - A `max` cap on `create-issue` per run ([safe outputs](https://github.github.com/gh-aw/reference/safe-outputs/)).
- **Attractor spec:** `max_turns`, `max_tool_rounds_per_input`, loop detection, `goal_gate`, and bounded `max_retries` (§2.1).
- **Anthropic Code Review:** monthly org spend caps, per-repo enablement, and a cost dashboard ([claude.com](https://claude.com/blog/code-review)).
- **Agent loops really do misbehave.** In Carlini's run, "Claude `pkill -9 bash` on accident, thus killing itself and ending the loop". His other failure: 16 agents all fixing the same kernel bug and overwriting each other ([C compiler](https://www.anthropic.com/engineering/building-c-compiler)).

### 2.10 What the PM sees

- **Demo artifacts.**
  - [Showboat](https://github.com/simonw/showboat): the agent builds a Markdown demo from real `exec` output, and `verify` re-runs it.
  - [Rodney](https://github.com/simonw/rodney): browser automation for the same purpose.
  - OpenAI: before and after videos.
  - Cursor cloud agents: "artifacts (videos, screenshots, and logs)". "More than 30% of the PRs we merge at Cursor are now created by agents operating autonomously" ([Cursor](https://cursor.com/blog/agent-computer-use)).
  - For terminal UIs, the equivalent is [VHS](https://github.com/charmbracelet/vhs). `.tape` scripts render GIF/MP4, and can also output `golden.ascii` "to ensure there are no diffs between runs". It has a CI action.
- **Digests.** [Linear Pulse](https://linear.app/docs/pulse) summarises project and initiative updates daily or weekly in the Inbox at about 6 AM, with an audio playback option. Admins set the default cadence.
- **Review UIs aimed at humans** (Devin Review diff ordering, Anthropic's single overview comment) are for code readers. A PM-only owner mostly needs outcomes, not diffs `[INFERENCE]`.

---

### 3. Fit for tuicraft

Repo facts, from local reads:
- `AGENTS.md` already requires `mise test:live` after protocol or daemon changes, with two dedicated accounts.
- It says: "Live-first testing: validate behavior against the real server, then encode it in mock integration tests as a living spec."
- It gives one agent exclusive CLI ownership per character.
- `main` has `required_linear_history`.
- `src/test/mock-auth-server.ts` and `src/test/mock-world-server.ts` exist.
- `docs/evidence/` holds committed live-evidence records (for example m2 encounter JSONs, and `2026-09-23-directed-movement.json`, which records a failed live run because credentials were missing).

**Lightweight?** Yes, if tuicraft copies the *verification* ideas and not the swarm:
- Gas Town-style orchestration is not needed. Carlini used a bash loop and lock files ([C compiler](https://www.anthropic.com/engineering/building-c-compiler)). gh-aw's controls are YAML frontmatter.
- The token-heavy parts are optional:
  - StrongDM's continuous scenario swarms
  - multi-pass review at $15–25 per PR
  - long evaluator loops

**Works with omp/Orca on a self-hosted VM?** `[INFERENCE]` Every pattern above is harness-agnostic: git worktrees, a CLI verifier, GitHub checks, cron. OpenAI's "bootable per git worktree" maps directly onto Orca worktrees, with one daemon and mock server per worktree. I have not checked omp-specific hooks (budgets, turn caps). A peer (LocalInventory) covers them.

**Works with linear history?** Yes: merge queue with the rebase or squash method, and reverts are ordinary commits (§2.7). Avoid anything that produces merge commits, such as the queue's "merge" method. `[INFERENCE]`

**Scarce live resource (two accounts, one owner per character).** The DTU idea fits unusually well here:
1. **Mock server as the twin (you already have one).** Grow `mock-world-server.ts` into the default scenario target. Validate it against the real server "until we stop finding behavioral differences" ([DTU](https://factory.strongdm.ai/techniques/dtu)). Use the real AzerothCore behaviour as the compatibility target, as StrongDM did with reference SDKs.
2. **Private AzerothCore in Docker on the VM** as a second tier. [acore-docker](https://www.azerothcore.org/acore-docker/) and the [install guide](https://www.azerothcore.org/wiki/install-with-docker) provide worldserver, authserver and DB via compose, and `account create` on the worldserver console. `[INFERENCE]` This removes the two-account cap. The QA agent and the per-PR live checks could each create their own throwaway accounts and characters, so the dedicated real-server accounts are needed only for the final serialized live gate. It also removes the danger of destructive tests. VM resources, client-data extraction time, and whether its behaviour matches the target server are all `[UNVERIFIED]`.
3. **Serialize real-server live tests** behind a lock: a merge-queue concurrency of 1, or a lock file like Carlini's `current_tasks/`. Run them post-merge on main (a soak run), plus pre-merge only for PRs that change protocol or daemon code, which is the escalation trigger `AGENTS.md` already defines.

---

### 4. Quality gates for an agent-reviewed repo, ordered by value per effort

Each row gives the gate, why it is worth it (with a source), what it costs, and what it looks like in tuicraft.

1. **Required deterministic CI through a merge queue (rebase or squash).**
   - Why: the only check the agent "can't negotiate with" ([Latent Space](https://www.latent.space/p/reviews-dead)). Carlini added CI after agents kept breaking features ([C compiler](https://www.anthropic.com/engineering/building-c-compiler)).
   - Effort: low (config).
   - tuicraft: `mise ci` as the required check, plus a `merge_group` trigger.
2. **Acceptance criteria before work starts.** An issue without testable acceptance criteria is not "ready", and triage refuses to dispatch it.
   - Why: OpenAI's humans "translate user feedback into acceptance criteria" ([OpenAI](https://openai.com/index/harness-engineering/)); Anthropic's sprint contract ([harness design](https://www.anthropic.com/engineering/harness-design-long-running-apps)).
   - Effort: low (issue template plus a triage rule).
   - tuicraft: the PM writes the observable acceptance criteria. The triage agent turns them into scenario stubs.
3. **Acceptance tests and scenarios the author cannot edit.** A PR that changes both `src/**` and the holdout scenario directory fails. Alternatively, keep scenarios outside the worker's worktree.
   - Why: ImpossibleBench cheating ([arXiv](https://arxiv.org/abs/2510.20270)); StrongDM holdouts ([Willison](https://simonwillison.net/2026/Feb/7/software-factory/)).
   - Effort: low to medium.
   - tuicraft: a CI path check, with scenarios owned by the triage or QA agent.
4. **Proof-of-work artifact in every PR, produced by a tool.** Examples: a VHS tape with a golden ASCII check, a Showboat-style transcript, or evidence JSON.
   - Why: Willison ([proven to work](https://simonwillison.net/2025/Dec/18/code-proven-to-work/), [Showboat](https://simonwillison.net/2026/Feb/10/showboat-and-rodney/)); OpenAI videos; Cursor artifacts.
   - Effort: low to medium.
   - tuicraft: extend the existing `docs/evidence/` convention. CI re-runs the tape or transcript so the output cannot be hand-edited.
5. **Hard runaway limits.**
   - Limits: a work-in-progress cap on concurrent worktrees; at most N review/fix rounds per PR, after which it is labelled `needs-pm`; per-agent turn and time caps; a daily token budget; loop detection; bot-created issues never auto-dispatch a worker; a per-run cap on issues created.
   - Why: gh-aw defaults ([rate limits](https://github.github.com/gh-aw/reference/rate-limiting-controls/)); Attractor spec ([spec](https://github.com/strongdm/attractor/blob/main/coding-agent-loop-spec.md)).
   - Effort: low.
   - tuicraft: a cap in the dispatcher script plus omp session limits `[UNVERIFIED omp support]`.
6. **Independent verifier agent.** Fresh context, a skeptical and calibrated prompt, verify-before-post, and only blocking-severity findings gate the merge. Prefer the stronger model as the reviewer, not simply a different one.
   - Why: Anthropic ([harness design](https://www.anthropic.com/engineering/harness-design-long-running-apps), [Code Review](https://claude.com/blog/code-review)); Bugbot validator and voting ([Cursor](https://cursor.com/blog/building-bugbot)); asymmetric cross-model result ([arXiv](https://arxiv.org/abs/2607.21656)).
   - Effort: medium (the prompt needs tuning by reading its logs).
   - tuicraft: the reviewer runs the CLI against the mock server following the issue's acceptance criteria, rather than only reading the diff.
7. **Mock-server scenario suite as the twin, cross-checked against real server behaviour.**
   - Why: DTU ([StrongDM](https://factory.strongdm.ai/techniques/dtu)); already the stated policy in `AGENTS.md`.
   - Effort: medium, and ongoing.
   - tuicraft: every live finding becomes a mock scenario.
8. **Serialized live gate on main, plus revert-on-red.** Post-merge, `mise test:live` runs under a lock. If it fails, the agent opens a `git revert` PR through the queue and files an issue. Flaky tests are quarantined first.
   - Why: "revert faster" ([Latent Space](https://www.latent.space/p/reviews-dead)); OpenAI follow-up runs ([OpenAI](https://openai.com/index/harness-engineering/)).
   - Effort: medium.
   - tuicraft: fits the scarce accounts, because one run covers each batch.
9. **Escalation triggers.** PRs touching protocol, auth, crypto or daemon IPC require a pre-merge live run (or a private AzerothCore run).
   - Why: [Latent Space layer 4](https://www.latent.space/p/reviews-dead); `AGENTS.md` rule.
   - Effort: low.
   - tuicraft: path-based label and check.
10. **QA agent on main with dedupe.** It runs exploratory play on the private AzerothCore. The dedupe pattern: search in parallel, filter false positives, comment on the existing issue instead of opening a new one, cap issues per run, and auto-close only after a grace period with a veto.
    - Why: [anthropics/claude-code dedupe](https://github.com/anthropics/claude-code/blob/main/.claude/commands/dedupe.md).
    - Effort: medium to high (needs the private server).
    - tuicraft: this is the "QA agent files issues" step of the loop.
11. **Garbage-collection and doc-gardening agent** on a weekly cron, opening small refactor or doc PRs.
    - Why: OpenAI's "golden principles" ([OpenAI](https://openai.com/index/harness-engineering/)); METR's quality rejections ([METR](https://metr.org/notes/2026-03-10-many-swe-bench-passing-prs-would-not-be-merged-into-main/)).
    - Effort: medium.
    - tuicraft: counters drift that tests cannot see.
12. **Satisfaction scoring over holdout scenarios with an LLM judge**, run several trials each (pass^k).
    - Why: StrongDM ([Willison](https://simonwillison.net/2026/Feb/7/software-factory/)); Anthropic evals ([evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)).
    - Effort: high, and tokens.
    - tuicraft: most relevant for Jev/tactics behaviour, which is non-deterministic.

**What the PM does each week** `[INFERENCE, assembled from sources above]`:
- Writes or accepts acceptance criteria on new issues, and optionally adds eval or scenario tasks as PRs, as Anthropic suggests.
- Watches the per-PR demo artifacts (GIFs or evidence).
- Reads one digest: shipped changes (the CHANGELOG already exists), satisfaction or live-suite trend, open `needs-pm` escalations, and token spend against budget.
- Never reads diffs.

---

### 5. Open questions

1. Can the VM host a private AzerothCore (worldserver + DB + client data) next to the agents? How close is its behaviour to the target server used by `mise test:live`? `[UNVERIFIED]`
2. What limits does omp support natively: turn caps, token budgets, loop detection? Or must a dispatcher script enforce them? (LocalInventory peer.)
3. Where do holdout scenarios live so worker agents cannot read them: a separate repo, a path the worker is denied, or only in the QA agent's worktree? This is a trade-off between the StrongDM holdout idea and agents needing enough spec to build against.
4. Which model pairing should author and review? The only controlled data (arXiv 2607.21656) covers LiveCodeBench, not TypeScript protocol code. It is worth a small local A/B on the reviewer's resolution rate, using Bugbot's metric.
5. Who defines "satisfaction" for gameplay behaviour (tactics, cycles)? Anthropic's advice is to calibrate the judge against the PM's own verdicts on 20–50 real transcripts.
6. How flaky is `mise test:live` today? This decides whether automatic revert-on-red is safe, or should open a revert PR for the queue to decide.
7. There is no primary 2025–26 source on agent-run auto-revert bots or canary/soak for agent-written main branches; this report's recommendations there are prior-art inference.

## 5. Local tooling: Orca, omp, gh

Date: 2026-09-25. Method: repo reads (AGENTS.md, mise.toml, hk.pkl, .github/, docs/roadmap.md, .claude/settings.json), skill://orca-cli + skill://orchestration stubs, omp:// docs (cli-reference, session, task-agent-discovery, hooks, tools/github, tools/task, environment-variables), web cross-checks. **No shell or file-write tool exists in this environment, so no orca-ide/omp/gh/git command was actually executed** - all command claims come from docs/repo text; web items are cited. Binary --help output and gh auth status still need one VM session (open questions).

### 1) TL;DR

- **Headless spawn works today**: `omp -p "..."` (--print) runs non-interactively and exits; --mode json, --max-time, --cwd, --resume/--continue/--fork, --approval-mode/--yolo, --no-session, --no-title are the automation flags (omp://cli-reference.md).
- **Worktree spawn works today**: `orca-ide worktree create --name <n> --agent omp` (setup default; nested agents inherit setup+lineage) and `orca-ide worktree rm --worktree name:<n>` (AGENTS.md). Orca skill stubs hold no command reference - version-matched guide comes from the binary (`orca-ide skills get orca-cli` / `skills get orchestration`); could not run it here.
- **Completion detection is DIY**: headless exit code + session JSONL tail (~/.omp/agent/sessions/<encoded-cwd>/<ts>_<id>.jsonl, incl. custom session_exit records). No webhook/callback, no omp wait-for-session CLI found.
- **No built-in scheduler or webhook listener**: omp subcommands include ps/agents/worktree/share/commit/cleanse/usage/stats - no cron/daemon/scheduler, no webhook serve. Orca-side scheduling unconfirmed (needs orca-ide --help on VM). Plan on cron/systemd + poll script.
- **CI gap is small**: only GitHub Action is pages.yml (static-site deploy, no tests). `mise ci` = typecheck + test:coverage + format, enforced today only by hk pre-push hook; maps cleanly onto an Actions PR gate (already excludes live tests - exactly right given scarce test accounts).

### 2) Findings per capability

### 2.1 Headless omp spawn - YES (primary: omp://cli-reference.md)

- `omp [command] [flags] [messages...]`; first arg not a subcommand routes to launch with args as prompt. `omp -p "fix X"` = process prompt, stream to stdout, exit, no TUI. Stdin prompt accepted too.
- Automation flags: --cwd <dir> (start worker in worktree path), --mode json (structured events for pipelines), --max-time <600|10m|1h> (bound every factory spawn), --resume/--continue/--fork (retry/follow-up), --approval-mode yolo / --yolo (top-level workers need it; subagents already force yolo), --no-session/--session-dir, --no-title (skip title-model call), --tools a,b,c / --no-lsp (slim tool surface per role), --model/--smol/--slow + modelRoles (cheap models for triage/reviewer).
- In-repo corroboration: AGENTS.md cites `omp -p --no-session --no-tools "..."` as the probe idiom, confirming -p in the installed build.
- Exit-code semantics for -p NOT documented in what I read - verify on VM. Treat exit code as process health only; parse agent outcome from output/session (same lesson as tuicraft intent vs result envelopes).
- Token/cost telemetry: `omp usage` / `omp stats` exist - candidate for factory cost accounting. Pricing is provider-side. [UNVERIFIED on VM - docs index only.]

### 2.2 Orca worktree + terminal automation - YES for worktrees, LIKELY for terminal (primary: AGENTS.md; secondary: web)

- Verified in-repo: `orca-ide worktree create --name <name> --agent omp`; `orca-ide worktree rm --worktree name:<name>` (removes worktree+branch; do NOT pass --run-hooks - no archive hook exists). Factory create/destroy primitives proven in daily use.
- orca-cli/orchestration skills are discovery stubs: resolve binary (Linux outside managed terminals -> orca-ide; never bare orca = GNOME screen reader), then read `orca-ide skills get orca-cli` / `skills get orchestration`. Orchestration guide covers task creation/dispatch, lifecycle preambles, worker_done authority, decision gates, coordinator loops - a supervised multi-agent plane distinct from fire-and-forget worktree create.
- Terminal send/read/wait and orchestration task-create/run-create appear only in third-party write-ups (https://www.getclaudeskills.com/skills/orca-cli-stablyai, https://mcpservers.org/agent-skills/stablyai/orca-cli, https://github.com/stablyai/orca/issues/10849) - [UNVERIFIED] until orca-ide --help on VM. Recommendation: dumb poll loop over omp -p exits first (matches owner's lightweight preference); supervised orchestration later if needed.
- No scheduler/automation subcommand surfaced anywhere readable. Assume absent until disproven by binary help.

### 2.3 Completion detection - NO built-in primitive; three workable signals

1. Process exit of `omp -p` (simplest; semantics to verify).
2. Session JSONL: ~/.omp/agent/sessions/<encoded-cwd>/<ts>_<id>.jsonl, append-only entries + leafId; custom session_exit {reason, kind: normal|signal|fatal|process_exit, pendingToolCalls} written with flushSync() so a watcher can inspect the last durable turn (omp://session.md). Use --session-dir per worker to keep it tidy.
3. Git state: worker commits in its worktree (convention: independent agents commit freely in own worktree, AGENTS.md) - branch heads are ground truth for reviewer/QA stages.
- omp task-tool background jobs + proc://<id> are in-session constructs (parent must stay alive) - wrong shape for cross-process factory; prefer one OS process per worker. omp ps supervises background processes (details unread) - possible keep-alive, needs VM check.

### 2.4 Scheduler / webhook listener - NOT PRESENT (docs-index + repo absence)

- omp subcommand roster (32 entries: launch, acp, auth-broker/gateway, agents, bench, browser-relay, cleanse, commit, completions, compress, config, dry-balance, gc, grep, gallery, git, grievances, images, install, join, models, plugin, ps, say, share, setup, shell, read, render, ssh, stats, update, usage, tiny-models, token, ttsr, worktree, search). No cron/schedule/daemon/serve/webhook. Closest automation hooks: .omp/hooks/pre|post/*.ts events, session_exit records, github run_watch (polls Actions runs - reusable for QA stage).
- Loop driver is ~50 lines of external scripting: cron/systemd -> gh issue list -> orca-ide worktree create -> omp -p --cwd <wt> --max-time ... -> on exit gh pr create. GitHub-side trigger alternative: scheduled Actions + SSH to VM, or webhook relay - all custom, none present.
- Serialized scarce resources (two game-server test accounts; one CLI owner per character per AGENTS.md) need a mutex the tools don't provide: lockfile/label convention around mise test:live + character assignment in the driver script.

### 2.5 GitHub integration - present but read-gated

- mise.toml pins gh=latest via mise; remote https://github.com/tvararu/tuicraft.git (main .git/config); current worktree linear-async-dev-factory-spike.
- .claude/settings.json allow-lists only read gh commands (issue list, release list/view, repo view, run list/view, search:*) - NO gh pr create/review/merge, issue create. Factory workers need those appended: deliberate permission escalation to record.
- omp github agent tool (default github.enabled=false; needs gh on PATH): pr_create/pr_checkout/pr_push/repo_view/file_read/search_*/run_watch. NOTE: pr_checkout creates its OWN worktrees under ~/.omp/wt/<pr>-<hash> with pr-<n> branches - a second worktree convention colliding with Orca-managed ones. Pick one: Orca worktrees (recommended - matches AGENTS.md, setup hooks, lineage).
- gh --version / gh auth status not runnable here (no shell); open question 1.

### 2.6 Existing CI - pages-only; mise ci is PR-gate-suitable

- .github/workflows/pages.yml: on push to main, copies site/* + .github/install.sh to Pages. No test/typecheck/format workflow. (CHANGELOG shows CI-on-PRs + lcov existed historically, since removed; mise ci docstring confirms no gh signoff, no remote CI.)
- mise ci = typecheck (tsc --noEmit) + test:coverage (bun test --coverage) + format (biome format src/, check). hk pre-push adds clean-tree + conventional-commit subject <=50 chars + wrapped body (hk.pkl). Gate suitability: YES - deterministic, hermetic (mise pins bun/biome/hk/gh/jq), excludes test:live (scarce accounts stay out of CI), mirrors pre-push so local/remote agree. Sketch: mise install && mise ci. Caveats: build/bundle deps (bun install + hk install) first; format covers only src/.
- Linear history: main has required_linear_history; merges rejected at push (GH013, misleading error). AGENTS.md prescribes cherry-pick integration (-c core.editor=true for editor trap), bans merges. PR factory => squash-merge (or rebase-merge) only, or reviewer-agent cherry-picks. Current rule One integration owner, No PRs + releases paused (no release-please) - the factory deliberately changes this; record the decision.

### 2.7 In-session multi-agent (cheap reviewer/triage plane)

- omp task tool: batch fan-out ({context, tasks[]}, semaphore task.maxConcurrency), background jobs under async.enabled, per-agent models via task.agentModelOverrides + modelRoles, isolated patch/branch workspaces, agent://<id> output + history://<id> transcripts (omp://tools/task.md, omp://task-agent-discovery.md). Bundled reviewer + security-reviewer agents. Triage + reviewer can live here (no worktree overhead); per-issue workers keep Orca worktrees. Depth cap task.maxRecursionDepth=2 default; plan mode forces read-only tools.

### 3) Fit for tuicraft

- Lightweight? Yes with dumb loop: cron + worktree create --agent omp + omp -p --cwd/--max-time/--yolo + exit/session polling + gh. Avoid orchestration DAGs and omp isolated workspaces initially.
- omp/Orca on self-hosted VM? Already the daily driver. Nothing to install except gh auth verify + write-capable gh allow-listing.
- Linear history? Compatible via squash-merge-only or reviewer cherry-picks. Handle GH013-looks-like-auth footgun in factory errors.
- Scarce live tests? mise ci excludes them by construction; add driver-owned lock + main-only QA stage for mise test:live with one-agent-per-character rule in worker prompts.

### 4) Gaps the factory must fill

1. Driver script (cron/systemd): poll gh issue list --label ready, one worktree + omp -p per issue, cap concurrency.
2. Completion convention: --max-time everywhere; parse --mode json or session tail; post outcome to the issue.
3. Reviewer lane: reviewer agent -> squash-merge or cherry-pick to main; forbid merge commits in script.
4. QA lane on main: post-merge mise ci + locked mise test:live; file new issues with logs on failure (needs gh issue create).
5. Permissions: gh pr create/review/merge, gh issue create/comment in allow-lists; PAT vs GitHub App decision for driver.
6. Live-test lock: lockfile/label mutex for two test accounts + character->worker map.
7. PR-gate workflow: .github/workflows/ci.yml running mise ci (minutes, no secrets, no live tests).

### 5) Open questions (one VM/tool session)

1. gh --version + gh auth status (redacted) + git remote -v.
2. orca-ide --help (+ worktree/terminal/agent/orchestration/automation subhelps), orca-ide skills get orca-cli / orchestration: confirm terminal send/wait + scheduler surface.
3. omp --help (+ ps/agents/worktree/share/usage): confirm -p exit-code contract, supervision fit, cost fields.
4. Any webhook listener on VM (ports/systemd) - expected none.
5. Owner decisions: orchestration vs dumb loop; App vs PAT; squash vs cherry-pick; amending AGENTS.md No PRs rule.

Sources: AGENTS.md, mise.toml, hk.pkl, .github/workflows/pages.yml, .github/install.sh, docs/roadmap.md, .claude/settings.json, package.json, skill://orca-cli, skill://orchestration, omp://cli-reference.md, omp://session.md, omp://hooks.md, omp://task-agent-discovery.md, omp://tools/task.md, omp://tools/github.md, omp://environment-variables.md; web (secondary): getclaudeskills/mcpservers orca-cli mirrors, dev.to autonomous PR-review loop, developersdigest opencode-cron guide.

### Verified on the VM afterwards (coordinator, 2026-09-25)

These results come from real command output and override the scout's claims above, which it could only take from docs:

- `orca-ide --help`: Orca **does** ship a scheduler. `orca automations create --name --trigger <hourly|daily|weekdays|weekly|cron|RRULE> --prompt --provider <agent> [--precheck <cmd>] [--workspace-mode existing|new-per-run] [--base-branch] [--reuse-session|--fresh-session]`. When the precheck exits non-zero, the run is skipped and recorded as skipped. When `--workspace` is omitted, each run gets a new worktree. `orca automations list` currently reports "No automations found".
- Orca has first-party Linear commands: `orca linear list|issue|save-issue|status set|comment add|label …|relation …`, `worktree create --linear-issue`, and the bundled `orca-linear` skill. `orca linear team list` reports "No Linear teams found", so Linear is not connected yet.
- `worktree create` also accepts `--issue <number>` (GitHub issue linkage), `--prompt`, `--base-branch`, `--setup run|skip|inherit`.
- Orca orchestration (`run-create`, `task-create`, `dispatch`, `worker-start/show/read/stop/release`, `gate-create/resolve`, `ask/reply`) is available for supervised runs.
- It is not yet verified whether `omp` is accepted as an automations `--provider`. `agent-context` lists `codex`, `claude` and `gemini` as examples, and `worktree create --agent omp` is used every day.
- `gh auth status`: logged in as `OpenHubris`. `origin` = `https://github.com/tvararu/tuicraft.git`. `gh` 2.101.0.
- `gh api repos/tvararu/tuicraft`: owner type `User`, public. `OpenHubris` has `push`/`triage` access but not `admin`, so it cannot edit rulesets or repository settings. Collaborators: `tvararu` (admin), `OpenHubris` (write).
- Ruleset `main` (id 12936638, active, `~DEFAULT_BRANCH`): `deletion`, `non_fast_forward`, `creation`, `required_linear_history`. No PR, review or status-check rules. No bypass actors. No classic branch protection.
- Merge settings as of 2026-09-25 (after the owner changed them): squash and merge commits enabled, default message = PR title and description, rebase enabled, auto-merge enabled, branches deleted on merge.
