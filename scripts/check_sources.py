#!/usr/bin/env python3
"""Source URL health check.

Scans every question's source.url and reports:
- empty/missing
- non-HTTP scheme
- unreachable (DNS / connection error)
- 4xx/5xx
- redirect chains

Output: writes summary to data/source_health.json and a Markdown report to
data/source_health.md.

Runs concurrently with a small thread pool. Uses HEAD first, falls back to GET
because some sites (Wikipedia in particular) return 405 on HEAD.
"""
import json
import os
import re
import sys
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    import requests
except ImportError:
    print("requests not installed. Install with: pip3 install requests", file=sys.stderr)
    sys.exit(1)


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QUESTIONS = os.path.join(ROOT, "data", "questions.json")
OUT_JSON = os.path.join(ROOT, "data", "source_health.json")
OUT_MD = os.path.join(ROOT, "data", "source_health.md")

TIMEOUT = 15
# Real-browser UA — many legit sites (Census, OECD, Britannica) reject bot UAs
# with 403. This makes the audit reflect real user reachability.
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)


def classify(url: str) -> dict:
    entry = {"url": url, "final_url": None, "status": None, "ok": False, "reason": None}
    if not url or not isinstance(url, str) or not url.strip():
        entry["reason"] = "empty"
        return entry
    url = url.strip()
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https"):
        entry["reason"] = f"bad-scheme:{parsed.scheme or 'none'}"
        return entry
    headers = {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }
    try:
        # Try HEAD first (cheap). Fall back to GET for methods/UA-blocked sites.
        r = requests.head(url, headers=headers, allow_redirects=True, timeout=TIMEOUT)
        if r.status_code in (403, 405, 501):
            r = requests.get(url, headers=headers, allow_redirects=True, timeout=TIMEOUT, stream=True)
            r.close()
        entry["status"] = r.status_code
        entry["final_url"] = r.url
        if 200 <= r.status_code < 400:
            entry["ok"] = True
        else:
            entry["reason"] = f"http-{r.status_code}"
        return entry
    except requests.exceptions.SSLError as e:
        entry["reason"] = f"ssl:{type(e).__name__}"
    except requests.exceptions.ConnectionError as e:
        # DNS or refused connection
        msg = str(e)
        if "Name or service not known" in msg or "nodename nor servname" in msg or "Failed to resolve" in msg:
            entry["reason"] = "dns"
        else:
            entry["reason"] = "connection"
    except requests.exceptions.Timeout:
        entry["reason"] = "timeout"
    except requests.exceptions.TooManyRedirects:
        entry["reason"] = "redirect-loop"
    except requests.exceptions.RequestException as e:
        entry["reason"] = f"error:{type(e).__name__}"
    return entry


def main():
    with open(QUESTIONS) as f:
        questions = json.load(f)

    # Unique URL set — many questions share the same source
    url_to_qids: dict[str, list[str]] = {}
    for q in questions:
        u = (q.get("source") or {}).get("url") or ""
        url_to_qids.setdefault(u.strip(), []).append(q["id"])

    unique_urls = [u for u in url_to_qids.keys() if u]
    empty_qids = url_to_qids.get("", [])
    print(f"Unique non-empty URLs: {len(unique_urls)}", flush=True)
    print(f"Questions with empty URL: {len(empty_qids)}", flush=True)

    results: dict[str, dict] = {}
    start = time.time()
    with ThreadPoolExecutor(max_workers=16) as ex:
        futures = {ex.submit(classify, u): u for u in unique_urls}
        done = 0
        for fut in as_completed(futures):
            u = futures[fut]
            try:
                results[u] = fut.result()
            except Exception as e:
                results[u] = {"url": u, "ok": False, "reason": f"crash:{type(e).__name__}"}
            done += 1
            if done % 25 == 0:
                elapsed = time.time() - start
                print(f"  checked {done}/{len(unique_urls)} in {elapsed:.1f}s", flush=True)

    # Build per-question rollup with question id list on each entry
    for u, entry in results.items():
        entry["question_ids"] = url_to_qids[u]
        entry["question_count"] = len(url_to_qids[u])

    ok = sum(1 for e in results.values() if e["ok"])
    broken = [e for e in results.values() if not e["ok"]]
    broken.sort(key=lambda e: e["question_count"], reverse=True)

    payload = {
        "checked_at": int(time.time() * 1000),
        "total_questions": len(questions),
        "unique_urls": len(unique_urls),
        "empty_urls": len(empty_qids),
        "ok_urls": ok,
        "broken_urls": len(broken),
        "broken_questions_touched": sum(e["question_count"] for e in broken),
        "results": results,
    }
    with open(OUT_JSON, "w") as f:
        json.dump(payload, f, indent=2)

    # Markdown report — grouped by failure reason, ordered by question impact
    by_reason: dict[str, list[dict]] = {}
    for e in broken:
        by_reason.setdefault(e.get("reason") or "unknown", []).append(e)

    lines = []
    lines.append(f"# Source URL health report — {time.strftime('%Y-%m-%d %H:%M')}\n")
    lines.append(f"- Total questions: **{len(questions)}**")
    lines.append(f"- Unique non-empty URLs: **{len(unique_urls)}**")
    lines.append(f"- Empty/missing URLs: **{len(empty_qids)}** (touches {len(empty_qids)} questions)")
    lines.append(f"- URLs OK (2xx/3xx): **{ok}**")
    lines.append(f"- URLs broken: **{len(broken)}** (touches **{sum(e['question_count'] for e in broken)}** questions)\n")

    for reason, group in sorted(by_reason.items(), key=lambda x: -sum(e["question_count"] for e in x[1])):
        group.sort(key=lambda e: e["question_count"], reverse=True)
        touched = sum(e["question_count"] for e in group)
        lines.append(f"\n## {reason} — {len(group)} URLs, {touched} questions\n")
        for e in group[:50]:
            lines.append(f"- `{e['url']}` — {e['question_count']} questions ({e['question_ids'][0]} …)")
        if len(group) > 50:
            lines.append(f"- _(and {len(group) - 50} more)_")

    if empty_qids:
        lines.append(f"\n## empty/missing URL — {len(empty_qids)} questions\n")
        for qid in empty_qids[:100]:
            lines.append(f"- {qid}")
        if len(empty_qids) > 100:
            lines.append(f"- _(and {len(empty_qids) - 100} more)_")

    with open(OUT_MD, "w") as f:
        f.write("\n".join(lines) + "\n")

    print(f"\nSummary: {ok}/{len(unique_urls)} unique URLs OK ({len(broken)} broken)")
    print(f"Broken URLs touch {sum(e['question_count'] for e in broken)} of {len(questions)} questions")
    print(f"JSON:  {OUT_JSON}")
    print(f"MD:    {OUT_MD}")


if __name__ == "__main__":
    main()
