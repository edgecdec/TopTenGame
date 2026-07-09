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

# Depth thresholds by theme. If a question is below the threshold for its theme
# it's considered "shallow" — a candidate for another deepen pass. The goal is
# full source depth: UN/WB rankings cover ~195 countries, USDA/NASS cover ~51
# states, so we target much deeper than the initial 20-row cutoff.
SHALLOW_BY_THEME = {
    "Countries": 80,
    "US States": 45,
}
DEFAULT_SHALLOW = 25  # fallback for themes without an explicit threshold

# A question that's already sitting in an existing batch input file is skipped
# so we don't dispatch the same question in multiple parallel agents.


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


def group_shallow(questions, theme_filter: str | None = None):
    """{subtheme: [question, ...]} where seededDepth < the theme's threshold."""
    already = existing_batched_ids()
    by_sub = defaultdict(list)
    for q in questions:
        theme = q.get("theme")
        if theme_filter and theme != theme_filter:
            continue
        threshold = SHALLOW_BY_THEME.get(theme, DEFAULT_SHALLOW)
        if q.get("seededDepth", 0) >= threshold:
            continue
        if q["id"] in already:
            continue
        # Group key includes theme prefix so mixed-theme reports stay readable.
        sub = q.get("subtheme") or "(none)"
        by_sub[f"{theme} :: {sub}"].append(q)
    for sub in by_sub:
        by_sub[sub].sort(key=lambda q: q["seededDepth"])
    return by_sub


def report(by_sub):
    if not by_sub:
        print("Nothing shallow left outside existing batches.")
        return
    total = sum(len(v) for v in by_sub.values())
    print(f"Shallow questions not yet batched: {total}")
    print("Broken down by theme :: subtheme (sorted by remaining):\n")
    for sub, items in sorted(by_sub.items(), key=lambda kv: -len(kv[1])):
        print(f"  {len(items):>4}  {sub}")


def write_batch(theme: str, sub: str, chunk: list, idx: int):
    theme_slug = slugify(theme)
    sub_slug = slugify(sub)
    cluster = f"deepen_{theme_slug}_{sub_slug}_{idx}"
    path = os.path.join(DEEPEN_DIR, f"{cluster}.input.json")
    payload = {
        "cluster": cluster,
        "theme": theme,
        "subtheme": sub,
        "question_ids": [q["id"] for q in chunk],
        "current_depths": {q["id"]: q["seededDepth"] for q in chunk},
        "titles": {q["id"]: q["title"] for q in chunk},
        "sources": {q["id"]: q["source"] for q in chunk},
    }
    with open(path, "w") as f:
        json.dump(payload, f, indent=2)
    return cluster


def next_batch_index_for(theme_slug: str, sub_slug: str) -> int:
    """Next unused numeric suffix for `deepen_{theme_slug}_{sub_slug}_N`."""
    if not os.path.isdir(DEEPEN_DIR):
        return 0
    prefix = f"deepen_{theme_slug}_{sub_slug}_"
    used = set()
    for fn in os.listdir(DEEPEN_DIR):
        if not (fn.startswith(prefix) and fn.endswith(".input.json")):
            continue
        mid = fn[len(prefix): -len(".input.json")]
        try:
            used.add(int(mid))
        except ValueError:
            pass
    i = 0
    while i in used:
        i += 1
    return i


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--build", action="store_true",
                        help="Actually write batch files (default: just report).")
    parser.add_argument("--theme", type=str, default=None,
                        help="Restrict to one theme (e.g. 'Countries', 'US States').")
    parser.add_argument("--subtheme", type=str, default=None,
                        help="Restrict to one subtheme (name only, no theme prefix).")
    parser.add_argument("--batches", type=int, default=1,
                        help="How many batches to build per subtheme (when --build). Default 1.")
    parser.add_argument("--per-batch", type=int, default=8,
                        help="Questions per batch. Default 8.")
    args = parser.parse_args()

    os.makedirs(DEEPEN_DIR, exist_ok=True)
    questions = load_questions()
    by_sub = group_shallow(questions, theme_filter=args.theme)

    if args.subtheme:
        want = args.subtheme
        by_sub = {k: v for k, v in by_sub.items() if k.split(" :: ", 1)[-1] == want}
        if not by_sub:
            print(f"No shallow questions in subtheme {want!r}.")
            return

    report(by_sub)

    if not args.build:
        print("\n(dry run — pass --build to actually write batch files)")
        return

    print("\nBuilding batches...")
    made = []
    for key, items in sorted(by_sub.items()):
        theme, sub = key.split(" :: ", 1)
        theme_slug = slugify(theme)
        sub_slug = slugify(sub)
        remaining = list(items)
        for _ in range(args.batches):
            if not remaining:
                break
            chunk = remaining[:args.per_batch]
            remaining = remaining[args.per_batch:]
            idx = next_batch_index_for(theme_slug, sub_slug)
            cluster = write_batch(theme, sub, chunk, idx)
            made.append((cluster, len(chunk)))
            print(f"  {cluster}: {len(chunk)} questions")
    print(f"\nBuilt {len(made)} batches, {sum(n for _, n in made)} questions total.")
    print("Now dispatch agents against these files, then run scripts/deepen_merge.py.")


if __name__ == "__main__":
    main()
