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
    """Normalize any known patch shape into a flat list of {id, changes}.

    Handles:
    - Canonical: {updates: [{id, changes: {answers, seededDepth}}, ...]}
    - Dict-keyed updates: {updates: {"<qid>": {answers, ...}, ...}}
    - Bare list: [{id, changes: {answers,...}}, ...]
    - Direct updates: [{id, answers, seededDepth}, ...]  (no "changes" wrapper)
    - "add" variant: [{question_id, add: [...]}, ...] — those rows get APPENDED
      to the question's existing answers rather than replacing them.
    """
    if isinstance(patch_obj, list):
        raw = patch_obj
    elif isinstance(patch_obj, dict):
        raw = patch_obj.get("updates", [])
    else:
        return []

    out = []
    if isinstance(raw, dict):
        for qid, changes in raw.items():
            out.append({"id": qid, "changes": changes})
        return out

    for u in raw:
        if not isinstance(u, dict):
            continue

        # RFC 6902 JSON-Patch: {op, path, value}. `path` is /questions/<id>/answers
        # or similar; `value` is the answers array (or a whole question dict).
        if "op" in u and "path" in u and "value" in u:
            path = str(u["path"])
            # crude but sufficient: last non-empty segment is the field, prior is id
            segs = [s for s in path.split("/") if s]
            if len(segs) >= 2:
                qid = segs[-2]
                field = segs[-1]
                value = u["value"]
                if field == "answers" and isinstance(value, list):
                    out.append({"id": qid, "changes": {"answers": value}})
                elif field == "seededDepth" and isinstance(value, int):
                    out.append({"id": qid, "changes": {"seededDepth": value}})
                elif isinstance(value, dict):
                    out.append({"id": qid, "changes": value})
            continue

        qid = u.get("id") or u.get("question_id")
        if not qid:
            continue

        # "add" variant: append to existing answers.
        if "add" in u and isinstance(u["add"], list):
            out.append({"id": qid, "changes": {"_add": u["add"]}})
            continue

        # Standard "changes" wrapper
        if "changes" in u and isinstance(u["changes"], dict):
            out.append({"id": qid, "changes": u["changes"]})
            continue

        # Direct updates (id + answers on the same object)
        if "answers" in u:
            out.append({"id": qid, "changes": u})
            continue
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
            add_rows = changes.get("_add")

            # "add" variant: append to the question's existing answers.
            if add_rows is not None and new_answers is None:
                base = list(q.get("answers", []))
                have_codes = {a["code"] for a in base if isinstance(a, dict)}
                for a in add_rows:
                    if not isinstance(a, dict):
                        continue
                    if a.get("code") in have_codes:
                        continue
                    base.append(a)
                new_answers = base

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
