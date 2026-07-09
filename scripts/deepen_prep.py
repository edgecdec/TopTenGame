#!/usr/bin/env python3
"""Find shallow Countries questions and prep new deepen batches.

Usage:
  # See coverage report — no side effects
  python3 scripts/deepen_prep.py

  # Build the next batch of 8 for every subtheme with any shallow questions left
  python3 scripts/deepen_prep.py --build

  # Focus on ONE subtheme (build multiple batches for it)
  python3 scripts/deepen_prep.py --subtheme "Sports" --build --batches 5

Each batch file lands in data/deepen/deepen_countries_<subtheme>_<n>.input.json,
using the lowest unused suffix so it never collides with prior batches.
"""
import argparse
import json
import os
import re
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
QUESTIONS_PATH = os.path.join(DATA_DIR, "questions.json")
DEEPEN_DIR = os.path.join(DATA_DIR, "deepen")

# Countries with depth < this are considered "shallow" and worth deepening.
SHALLOW_THRESHOLD = 20

# Any question that's already in an existing batch's input file is skipped —
# we don't want to re-dispatch the same question in multiple parallel agents.


def slugify(sub: str) -> str:
    """Turn a subtheme name into the filename slug we use in batch files."""
    s = sub.lower()
    s = s.replace(" & ", "_")
    s = s.replace(" - ", "_")
    s = re.sub(r"[^a-z0-9]+", "_", s)
    s = s.strip("_")
    return s


def load_questions():
    with open(QUESTIONS_PATH) as f:
        return json.load(f)


def existing_batched_ids() -> set[str]:
    """Every question id that appears in an input.json file already."""
    ids = set()
    if not os.path.isdir(DEEPEN_DIR):
        return ids
    for fn in os.listdir(DEEPEN_DIR):
        if not fn.endswith(".input.json"):
            continue
        with open(os.path.join(DEEPEN_DIR, fn)) as f:
            data = json.load(f)
        for qid in data.get("question_ids", []):
            ids.add(qid)
    return ids


def next_batch_index(subtheme_slug: str) -> int:
    """Return the next unused numeric suffix for this subtheme's batches."""
    if not os.path.isdir(DEEPEN_DIR):
        return 0
    prefix = f"deepen_countries_{subtheme_slug}_"
    used = set()
    for fn in os.listdir(DEEPEN_DIR):
        if not (fn.startswith(prefix) and fn.endswith(".input.json")):
            continue
        # Strip prefix + ".input.json"
        mid = fn[len(prefix): -len(".input.json")]
        try:
            used.add(int(mid))
        except ValueError:
            pass
    i = 0
    while i in used:
        i += 1
    return i


def group_shallow(questions):
    """{subtheme: [question, ...]} where seededDepth < SHALLOW_THRESHOLD."""
    already = existing_batched_ids()
    by_sub = defaultdict(list)
    for q in questions:
        if q.get("theme") != "Countries":
            continue
        if q.get("seededDepth", 0) >= SHALLOW_THRESHOLD:
            continue
        if q["id"] in already:
            continue
        sub = q.get("subtheme") or "(none)"
        by_sub[sub].append(q)
    # Sort each subtheme by shallowest first so we hit the biggest wins early.
    for sub in by_sub:
        by_sub[sub].sort(key=lambda q: q["seededDepth"])
    return by_sub


def report(by_sub):
    if not by_sub:
        print("No shallow Countries questions left outside existing batches.")
        return
    total = sum(len(v) for v in by_sub.values())
    print(f"Shallow Countries questions not yet batched: {total}")
    print(f"Broken down by subtheme (sorted by remaining):\n")
    for sub, items in sorted(by_sub.items(), key=lambda kv: -len(kv[1])):
        print(f"  {len(items):>4}  {sub}")


def write_batch(sub: str, chunk: list, idx: int):
    slug = slugify(sub)
    cluster = f"deepen_countries_{slug}_{idx}"
    path = os.path.join(DEEPEN_DIR, f"{cluster}.input.json")
    payload = {
        "cluster": cluster,
        "theme": "Countries",
        "subtheme": sub,
        "question_ids": [q["id"] for q in chunk],
        "current_depths": {q["id"]: q["seededDepth"] for q in chunk},
        "titles": {q["id"]: q["title"] for q in chunk},
        "sources": {q["id"]: q["source"] for q in chunk},
    }
    with open(path, "w") as f:
        json.dump(payload, f, indent=2)
    return cluster


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--build", action="store_true",
                        help="Actually write batch files (default: just report).")
    parser.add_argument("--subtheme", type=str, default=None,
                        help="Focus on one subtheme (exact name, e.g. \"Sports\").")
    parser.add_argument("--batches", type=int, default=1,
                        help="How many 8-question batches to build per subtheme "
                             "when --build is set. Default 1.")
    parser.add_argument("--per-batch", type=int, default=8,
                        help="Questions per batch. Default 8.")
    args = parser.parse_args()

    os.makedirs(DEEPEN_DIR, exist_ok=True)
    questions = load_questions()
    by_sub = group_shallow(questions)

    if args.subtheme:
        by_sub = {s: qs for s, qs in by_sub.items() if s == args.subtheme}
        if not by_sub:
            print(f"No shallow questions in subtheme {args.subtheme!r}.")
            return

    report(by_sub)

    if not args.build:
        print("\n(dry run — pass --build to actually write batch files)")
        return

    print("\nBuilding batches...")
    made = []
    for sub, items in sorted(by_sub.items()):
        remaining = list(items)
        for _ in range(args.batches):
            if not remaining:
                break
            chunk = remaining[:args.per_batch]
            remaining = remaining[args.per_batch:]
            idx = next_batch_index(slugify(sub))
            cluster = write_batch(sub, chunk, idx)
            made.append((cluster, len(chunk)))
            print(f"  {cluster}: {len(chunk)} questions")
    print(f"\nBuilt {len(made)} batches, {sum(n for _, n in made)} questions total.")
    print("Now dispatch agents against these files, then run scripts/deepen_merge.py.")


if __name__ == "__main__":
    main()
