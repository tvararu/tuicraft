# Milestone 2 Fault Exercises Runbook

Checklist for executing the three robustness fault exercises live against the server.

## Prerequisites

- Character alive and in Fairbreeze Village or Eversong Woods near targets.
- Target acquired (e.g. `tuicraft target <guid>`).
- Normal `TYPESAFE_API_KEY` set in the environment.
- Run commands from the project root.

---

## 1. Delayed Response Past the Bound

### 1A. Result-Age Bound Exceeded (`stale_age`)

Exercise a delay exceeding the 2000 ms result-age bound (`DEFAULT_MAX_AGE_MS = 2000`) where the response completes and discards.

1. Stop any running daemon:
   ```bash
   tuicraft stop
   ```
2. Start daemon with a 2500 ms injected delay:
   ```bash
   JEV_FAULT=delay:2500 tuicraft start
   ```
3. Acquire a target and start the fight:
   ```bash
   tuicraft target <guid>
   tuicraft fight <guid>
   ```
4. Wait 4 seconds for the request and delay to settle:
   ```bash
   sleep 4
   ```
5. Halt the fight:
   ```bash
   tuicraft halt
   ```
6. Check tactics state:
   ```bash
   tuicraft tactics --json
   ```
   **Expect in `tuicraft tactics --json`:**
   - `lastDecision.disposition`: `"discarded"`
   - `lastDecision.reason`: `"stale_age"`
   - `fault`: `"delay:2500ms"`
7. Distil the encounter record:
   ```bash
   mise evidence:encounter latest delayed-response-stale > docs/evidence/m2/delayed-response-stale.json
   ```
   **Proof field in distilled record:**
   - `discarded`: contains `{ "reason": "stale_age", "actionId": "<action>" }`
   - `fault`: `"delay:2500ms"`

### 1B. Request Timeout Exceeded (`jev_timeout`)

Exercise a delay exceeding the 5000 ms request timeout bound (`DEFAULT_TIMEOUT_MS = 5000`) where the timeout cancels the in-flight request. Each timeout is discarded without an action and the loop asks again; only `MAX_CONSECUTIVE_TIMEOUTS = 3` timeouts in a row stop the run.

1. Stop any running daemon:
   ```bash
   tuicraft stop
   ```
2. Start daemon with a 6000 ms injected delay:
   ```bash
   JEV_FAULT=delay:6000 tuicraft start
   ```
3. Acquire a target and start the fight:
   ```bash
   tuicraft target <guid>
   tuicraft fight <guid>
   ```
4. The `fight` command returns once three timeouts in a row (about 15 s) stop the run.
5. Check tactics state:
   ```bash
   tuicraft tactics --json
   ```
   **Expect in `tuicraft tactics --json`:**
   - `status`: `"idle"`
   - `lastStopReason`: `"failed"`
   - `lastDiscardReason`: `"jev_timeout"`
   - `lastOutcome.reason`: `"jev_timeout"`
   - `timeouts`: `{ "consecutive": 3, "total": 3, "limit": 3 }`
   - `defense`: `"auto_attack"` when the target is alive and attacking, otherwise `"uncontrolled_in_combat"` or `"none"`
   - `fault`: `"delay:6000ms"`
6. Distil the encounter record:
   ```bash
   mise evidence:encounter latest delayed-response-timeout > docs/evidence/m2/delayed-response-timeout.json
   ```
   **Proof field in distilled record:**
   - `transportErrors`: three `"jev_timeout"` entries
   - `outcome.status`: `"failed"`
   - `outcome.reason`: `"jev_timeout"`
   - `fault`: `"delay:6000ms"`

### 1C. One Request Timeout Mid-Fight (`jev_timeout`, recovered)

Exercise a single timed-out request inside a fight that continues.

1. Stop any running daemon, then start it with a 6000 ms delay on the third Jev request only:
   ```bash
   tuicraft stop
   JEV_FAULT=delay:6000@3 tuicraft start
   ```
2. Fight a target:
   ```bash
   tuicraft fight <guid>
   ```
3. Check tactics state:
   ```bash
   tuicraft tactics --json
   ```
   **Expect in `tuicraft tactics --json`:**
   - `lastOutcome.reason`: `"server_kill_credit"`
   - `timeouts`: `{ "consecutive": 0, "total": 1, "limit": 3 }`
   - `fault`: `"delay:6000ms@3"`

   The session log holds one TACTICS `transport` `jev_timeout`, then a new `request`, and later a `discarded` `aborted` for the late reply.

---

## 2. Obsolete Decision

Exercise an in-flight decision whose result returns after the run stops.

1. Stop any running daemon:
   ```bash
   tuicraft stop
   ```
2. Start daemon with a 2500 ms injected delay:
   ```bash
   JEV_FAULT=delay:2500 tuicraft start
   ```
3. Acquire a target and start the fight:
   ```bash
   tuicraft target <guid>
   tuicraft fight <guid>
   ```
4. Wait 1 second (provider request ~260 ms completes; response is held in delay):
   ```bash
   sleep 1
   ```
5. Halt while the decision is delayed:
   ```bash
   tuicraft halt
   ```
6. Wait 2 seconds for the delayed choice to resolve and register:
   ```bash
   sleep 2
   ```
7. Check tactics state:
   ```bash
   tuicraft tactics --json
   ```
   **Expect in `tuicraft tactics --json`:**
   - `status`: `"idle"`
   - `lastStopReason`: `"halt"`
   - `fault`: `"delay:2500ms"`
8. Distil the encounter record:
   ```bash
   mise evidence:encounter latest obsolete-decision > docs/evidence/m2/obsolete-decision.json
   ```
   **Proof field in distilled record:**
   - `discarded`: contains `{ "reason": "aborted", "actionId": "<action>" }`
   - `fault`: `"delay:2500ms"`

---

## 3. Model Unavailability

### 3A. Non-OK HTTP Status (`TypeSafe HTTP 503`)

Exercise an endpoint returning a non-OK HTTP status code.

1. Stop any running daemon:
   ```bash
   tuicraft stop
   ```
2. Start daemon with HTTP 503 fault:
   ```bash
   JEV_FAULT=http:503 tuicraft start
   ```
3. Acquire a target and start the fight:
   ```bash
   tuicraft target <guid>
   tuicraft fight <guid>
   ```
4. Wait 2 seconds for the failure to register:
   ```bash
   sleep 2
   ```
5. Check tactics state:
   ```bash
   tuicraft tactics --json
   ```
   **Expect in `tuicraft tactics --json`:**
   - `status`: `"idle"`
   - `lastStopReason`: `"failed"`
   - `lastDiscardReason`: `"TypeSafe HTTP 503"`
   - `lastOutcome.reason`: `"TypeSafe HTTP 503"`
   - `fault`: `"http:503"`
6. Distil the encounter record:
   ```bash
   mise evidence:encounter latest model-unavailable-http > docs/evidence/m2/model-unavailable-http.json
   ```
   **Proof field in distilled record:**
   - `transportErrors`: contains `"TypeSafe HTTP 503"`
   - `outcome.status`: `"failed"`
   - `outcome.reason`: `"TypeSafe HTTP 503"`
   - `fault`: `"http:503"`

### 3B. Transport Network Failure (`fetch failed`)

Exercise an endpoint connection failure at the transport layer.

1. Stop any running daemon:
   ```bash
   tuicraft stop
   ```
2. Start daemon with transport network failure:
   ```bash
   JEV_FAULT=transport tuicraft start
   ```
3. Acquire a target and start the fight:
   ```bash
   tuicraft target <guid>
   tuicraft fight <guid>
   ```
4. Wait 2 seconds for the transport failure to register:
   ```bash
   sleep 2
   ```
5. Check tactics state:
   ```bash
   tuicraft tactics --json
   ```
   **Expect in `tuicraft tactics --json`:**
   - `status`: `"idle"`
   - `lastStopReason`: `"failed"`
   - `lastDiscardReason`: `"fetch failed"`
   - `lastOutcome.reason`: `"fetch failed"`
   - `fault`: `"transport:network"`
6. Distil the encounter record:
   ```bash
   mise evidence:encounter latest model-unavailable-transport > docs/evidence/m2/model-unavailable-transport.json
   ```
   **Proof field in distilled record:**
   - `transportErrors`: contains `"fetch failed"`
   - `outcome.status`: `"failed"`
   - `outcome.reason`: `"fetch failed"`
   - `fault`: `"transport:network"`
