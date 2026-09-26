"""Measurement for docs/evidence/m2/instruction-pairs.md.

Run from the repository root: python3 docs/evidence/m2/instruction-pairs-measure.py
Reads the distilled records in docs/evidence/m2. The columns marked RAWLOG
come from docs/evidence/m2/instruction-pairs-rawlog.json, a reduced slice of
the account's session log.
"""
import collections
import json
import statistics
import sys

EV = "docs/evidence/m2/"
A = "defeat the selected target while keeping the character alive"
B = ("Conserve mana for several encounters. Favor efficient damage and use "
     "weapon attacks when useful. Keep enough health to survive safely.")
# costPercentageOfBaseMana from `spells --json` (build 12340 Spell.dbc)
COST = {585: 9, 591: 12, 8092: 17, 17: 23, 589: 22, 594: 22, 2050: 16,
        2052: 21, 2053: 27, 139: 17, 1243: 27}
# (pair, instruction letter, file, run order within pair)
FILES = [(0, "a", "encounter-04", 1), (0, "b", "encounter-05", 2)]
ORDER = {1: "ab", 2: "ba", 3: "ab", 4: "ba", 5: "ab", 6: "ba"}
for p, order in ORDER.items():
    for i, letter in enumerate(order):
        FILES.append((p, letter, f"pair-{p:02d}-{letter}", i + 1))


def spell_id(choice):
    return int(choice.split(":")[1]) if choice.startswith("spell:") else None


def bucket(offered):
    s = set(offered)
    if s == {"wait", "cancel"}:
        return "forced"
    if any(o.startswith("spell:") or o in ("attack", "face") for o in offered):
        return "fullkit"
    if s <= {"wait", "stop_attack"}:
        return "wait_stopattack"
    return "movement_only"


def raw_runs():
    data = json.load(open(EV + "instruction-pairs-rawlog.json"))["runs"]
    runs = {}
    for run in data.values():
        ok = collections.Counter()
        cut = collections.Counter()
        for c in run["combat"]:
            sid = (c["lastOutcome"] or {}).get("spellId")
            (ok if c["type"] == "cast_succeeded" else cut)[sid] += 1
        runs[run["runId"]] = {"req": [t["separation"] for t in run["tactics"] if t["type"] == "request"], "ok": ok, "cut": cut}
    return runs


def measure(path, raw):
    rec = json.load(open(EV + path + ".json"))
    ds = rec["decisions"]
    applied = [d for d in ds if d["applied"]]
    counts = collections.Counter(d["choice"] for d in applied)
    sid = collections.Counter(spell_id(d["choice"]) for d in applied
                              if spell_id(d["choice"]))
    nonwait = [d["choice"] for d in applied if d["choice"] not in ("wait", "face")]
    damage = [c for c in nonwait if c.endswith(":target") or c == "attack"]
    buckets = collections.Counter(bucket(d["offered"]) for d in ds)
    probs = collections.defaultdict(list)
    for d in ds:
        for k in ("spell:8092:target", "spell:17:self", "spell:585:target",
                  "spell:591:target", "attack"):
            if k in d["offered"]:
                probs[k].append(d["probabilities"].get(k, 0))
        if set(d["offered"]) == {"wait", "cancel"}:
            probs["cancel|forced"].append(d["probabilities"].get("cancel", 0))
    out = {
        "runId": rec["runId"], "instruction": rec["instruction"],
        "outcome": rec["outcome"]["reason"], "level": rec["character"]["level"],
        "tgt": rec["target"]["level"], "decisions": len(ds), "applied": len(applied),
        "counts": dict(sorted(counts.items())),
        "opener": nonwait[0] if nonwait else None,
        "firstDamage": damage[0] if damage else None,
        "shield": sid[17], "mindBlast": sid[8092], "smite585": sid[585],
        "smite591": sid[591], "attack": counts["attack"], "cancel": counts["cancel"],
        "moves": sum(v for k, v in counts.items() if k.startswith(("move_", "strafe_"))),
        "manaCasts": sum(sid.values()),
        "costPctBase": sum(COST.get(k, 0) * v for k, v in sid.items()),
        "buckets": dict(buckets),
        "meanP": {k: round(statistics.mean(v), 3) for k, v in probs.items()},
        "nOffered": {k: len(v) for k, v in probs.items()},
    }
    run = raw.get(rec["runId"])
    if run:
        seps = run["req"]
        first = next((i for i, d in enumerate(ds)
                      if d["applied"] and (d["choice"].endswith(":target")
                                           or d["choice"] == "attack")), None)
        out["RAWLOG_sep"] = {
            "start": round(seps[0], 1) if seps and seps[0] is not None else None,
            "atFirstDamage": round(seps[first], 1)
            if first is not None and first < len(seps) and seps[first] is not None else None,
            "min": round(min(s for s in seps if s is not None), 1),
            "requests": len(seps)}
        out["RAWLOG_serverCasts"] = {"succeeded": dict(run["ok"]),
                                     "interrupted": dict(run["cut"])}
    return rec, out


def main():
    raw = raw_runs()
    table = []
    per = collections.defaultdict(lambda: collections.defaultdict(list))
    for pair, letter, path, order in FILES:
        rec, m = measure(path, raw)
        want = A if letter == "a" else B
        if pair > 0:
            assert rec["instruction"] == want, path
        m.update(pair=pair, cond=letter.upper(), file=path, order=order)
        table.append(m)
        for k, v in m["meanP"].items():
            per[m["cond"]][k].append((v, m["nOffered"][k]))
    def fmt(v):
        return "-" if v is None else str(v)

    print("T1 per encounter, applied choices (from records)")
    print("pair|cond|ord|file|tgtLvl|dec|appl|opener|firstDamage|PWS17|MB8092|"
          "Smite585|Smite591|attack|cancel|moves|manaCasts|cost%base")
    for m in table:
        print("|".join(fmt(x) for x in (
            m["pair"], m["cond"], m["order"], m["file"], m["tgt"], m["decisions"],
            m["applied"], m["opener"], m["firstDamage"], m["shield"], m["mindBlast"],
            m["smite585"], m["smite591"], m["attack"], m["cancel"], m["moves"],
            m["manaCasts"], m["costPctBase"])))
    print("\nT2 per encounter, decision buckets (from records)")
    print("pair|cond|forced|wait_stopattack|movement_only|fullkit")
    for m in table:
        b = m["buckets"]
        print("|".join(fmt(x) for x in (m["pair"], m["cond"], b.get("forced", 0),
                                        b.get("wait_stopattack", 0),
                                        b.get("movement_only", 0), b.get("fullkit", 0))))
    keys = ("spell:8092:target", "spell:17:self", "spell:585:target",
            "spell:591:target", "attack", "cancel|forced")
    print("\nT3 per encounter, mean probability when offered (n rows) (from records)")
    print("pair|cond|" + "|".join(keys))
    for m in table:
        print("|".join([str(m["pair"]), m["cond"]] + [
            f"{m['meanP'][k]:.3f} ({m['nOffered'][k]})" if k in m["meanP"] else "-"
            for k in keys]))
    print("\nT4 per encounter, RAWLOG (instruction-pairs-rawlog.json, not in records)")
    print("pair|cond|sepStart|sepAtFirstDamage|sepMin|serverSucceeded|serverInterrupted|succeededCost%base")
    for m in table:
        s = m.get("RAWLOG_sep")
        c = m.get("RAWLOG_serverCasts")
        if not s:
            print(f"{m['pair']}|{m['cond']}|not recorded|-|-|-|-|-")
            continue
        ok = {k: v for k, v in c["succeeded"].items() if k != 836}
        print("|".join(str(x) for x in (
            m["pair"], m["cond"], s["start"], s["atFirstDamage"], s["min"],
            json.dumps(dict(sorted(ok.items()))), json.dumps(c["interrupted"]),
            sum(COST.get(k, 0) * v for k, v in ok.items()))))
    print("\nT5 per pair")
    print("pair|cost%base A|cost%base B|MB A|MB B|PWS A|PWS B|attack A|attack B|cancel A|cancel B")
    for p in range(0, 7):
        a = next(m for m in table if m["pair"] == p and m["cond"] == "A")
        b = next(m for m in table if m["pair"] == p and m["cond"] == "B")
        print("|".join(str(x) for x in (
            p, a["costPctBase"], b["costPctBase"], a["mindBlast"], b["mindBlast"],
            a["shield"], b["shield"], a["attack"], b["attack"], a["cancel"], b["cancel"])))
    print("\nPOOLED MEAN PROBABILITY WHEN OFFERED (row-weighted), pairs 1-6 and pair 0")
    for scope, pairs in (("pairs 1-6", range(1, 7)), ("pair 0", [0])):
        for cond in ("A", "B"):
            pool = collections.defaultdict(list)
            for pair, letter, path, order in FILES:
                if pair not in pairs or letter.upper() != cond:
                    continue
                rec = json.load(open(EV + path + ".json"))
                for d in rec["decisions"]:
                    for k in ("spell:8092:target", "spell:17:self", "spell:585:target",
                              "spell:591:target", "attack"):
                        if k in d["offered"]:
                            pool[k].append(d["probabilities"].get(k, 0))
                    if set(d["offered"]) == {"wait", "cancel"}:
                        pool["cancel|forced"].append(d["probabilities"].get("cancel", 0))
            print(scope, cond, {k: (round(statistics.mean(v), 3), len(v))
                                for k, v in sorted(pool.items())})


if __name__ == "__main__":
    sys.exit(main())
