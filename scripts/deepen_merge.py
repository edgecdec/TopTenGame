#!/usr/bin/env python3
"""Merge every deepen patch file into questions.json.

Idempotent — safe to run repeatedly. Skips any question whose current
seededDepth is already >= the patch's proposed answer count.

Tolerates all the schema variants we've seen in the wild:
- Canonical: {cluster, updates: [{id, changes: {answers, seededDepth}}], deletions: []}
- Dict updates: {cluster, updates: {"<qid>": {answers, seededDepth}}, ...}
- Bare list: [{id, changes: {answers, seededDepth}}, ...]
- Direct updates: [{id, answers, seededDepth}, ...]  (no "changes" wrapper)

Validates answer codes against answer_sets.json and drops any code not in
the theme's pool. Records a small stats block in stdout.
"""
import glob
import json
import os
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
QUESTIONS_PATH = os.path.join(DATA_DIR, "questions.json")
ANSWER_SETS_PATH = os.path.join(DATA_DIR, "answer_sets.json")
DEEPEN_DIR = os.path.join(DATA_DIR, "deepen")


def load_updates_from_patch(patch_obj):
    """Normalize any known patch shape into a flat list of {id, changes}."""
    if isinstance(patch_obj, list):
        raw = patch_obj
    elif isinstance(patch_obj, dict):
        raw = patch_obj.get("updates", [])
    else:
        return []

    out = []
    if isinstance(raw, dict):
        # dict keyed by question id
        for qid, changes in raw.items():
            out.append({"id": qid, "changes": changes})
        return out

    for u in raw:
        if not isinstance(u, dict):
            continue
        # If no "changes" wrapper, use the whole update dict as its own changes
        if "changes" in u and isinstance(u["changes"], dict):
            out.append(u)
        else:
            qid = u.get("id")
            if qid:
                out.append({"id": qid, "changes": u})
    return out


def main():
    with open(QUESTIONS_PATH) as f:
        questions = json.load(f)
    by_id = {q["id"]: q for q in questions}

    with open(ANSWER_SETS_PATH) as f:
        answer_sets = json.load(f)
    valid_by_type = {theme: {a["code"] for a in codes} for theme, codes in answer_sets.items()}

    patches = sorted(glob.glob(os.path.join(DEEPEN_DIR, "*.patch.json")))
    if not patches:
        print("No patch files found.")
        return

    total_applied = 0
    sum_old = 0
    sum_new = 0
    by_cluster = Counter()

    for pf in patches:
        with open(pf) as f:
            patch = json.load(f)
        updates = load_updates_from_patch(patch)
        cluster = os.path.basename(pf).replace(".patch.json", "")

        for u in updates:
            qid = u.get("id")
            q = by_id.get(qid)
            if not q:
                continue

            changes = u.get("changes", {})
            new_answers = changes.get("answers")
            if not isinstance(new_answers, list):
                continue
            # Idempotent skip: current depth is already at or beyond this patch's length
            if q["seededDepth"] >= len(new_answers):
                continue

            valid_codes = valid_by_type.get(q["answerType"], set())
            seen_codes = set()
            cleaned = []
            for a in new_answers:
                if not isinstance(a, dict):
                    continue
                code = a.get("code")
                if code not in valid_codes or code in seen_codes:
                    continue
                seen_codes.add(code)
                cleaned.append({
                    "rank": a.get("rank", len(cleaned) + 1),
                    "code": code,
                    "value": a.get("value", ""),
                })

            # Refuse to shorten a question by accident.
            if len(cleaned) < q["seededDepth"]:
                continue

            sum_old += q["seededDepth"]
            q["answers"] = cleaned
            new_depth = changes.get("seededDepth") or len(cleaned)
            q["seededDepth"] = min(new_depth, len(cleaned))
            sum_new += q["seededDepth"]
            total_applied += 1
            by_cluster[cluster] += 1

    with open(QUESTIONS_PATH, "w") as f:
        json.dump(questions, f, indent=2)

    print(f"Applied {total_applied} updates across {len(by_cluster)} clusters.")
    if total_applied:
        print(f"Avg seededDepth on touched questions: {sum_old / total_applied:.1f} -> "
              f"{sum_new / total_applied:.1f}")

    countries = [q for q in questions if q["theme"] == "Countries"]
    us_states = [q for q in questions if q["theme"] == "US States"]

    def stats(name, group):
        avg = sum(q["seededDepth"] for q in group) / max(len(group), 1)
        p20 = sum(1 for q in group if q["seededDepth"] >= 20)
        p30 = sum(1 for q in group if q["seededDepth"] >= 30)
        p40 = sum(1 for q in group if q["seededDepth"] >= 40)
        print(f"\n{name}: {len(group)} questions, avg depth {avg:.1f}")
        print(f"  depth >= 20: {p20} ({100 * p20 / max(len(group), 1):.1f}%)")
        print(f"  depth >= 30: {p30} ({100 * p30 / max(len(group), 1):.1f}%)")
        print(f"  depth >= 40: {p40} ({100 * p40 / max(len(group), 1):.1f}%)")

    stats("Countries", countries)
    stats("US States", us_states)


if __name__ == "__main__":
    main()
