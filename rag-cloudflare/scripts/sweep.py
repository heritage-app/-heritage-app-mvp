#!/usr/bin/env python3
"""
Dictionary-lookup regression sweep.

Asks "<english> in ga" for every short English translation in the vocabulary
and checks the answer is a headword that really carries that translation. It
is the check that caught 15 confidently wrong answers (butter -> Abɛi, key ->
Aduŋ, nail -> Waa: all substring hits) and, later, the man -> Maŋ (herring)
collision a lookup fix introduced.

    npx wrangler dev --local --port 8799        # in another terminal
    python scripts/sweep.py                      # local worker, local D1

Production, only when you mean it:

    python scripts/sweep.py --prod

Why local is the default: every miss triggers an embedding call, and on the
free tier Workers AI has a daily allowance. A full production sweep is a few
hundred requests; on 2026-09-28 a couple of them helped exhaust the allowance,
which then broke every model-dependent path for real users until midnight UTC.
Each miss also writes a knowledge_gaps row, so a production sweep pollutes the
gap table unless you clean up after it.

Exit status is 1 if any answer is WRONG — misses alone don't fail the sweep.
"""
import argparse
import concurrent.futures as cf
import json
import re
import subprocess
import sys
import urllib.request

LOCAL = "http://127.0.0.1:8799/api/v1"
PROD = "https://heritage-rag.heritage-app.workers.dev/api/v1"

# Cloudflare answers 403 to Python's default urllib user agent. An early run of
# this sweep counted those 403s as "not found" and reported 0% — send a normal UA.
HEADERS = {"Content-Type": "application/json", "X-Anonymous-ID": "sweep", "User-Agent": "curl/8.5.0"}


def load_vocabulary(remote: bool) -> list[dict]:
    """Read verified vocabulary through wrangler (reads only)."""
    cmd = [
        "npx", "wrangler", "d1", "execute", "heritage-db", "--remote" if remote else "--local", "--json",
        "--command",
        "SELECT headword, translations FROM vocabulary "
        "WHERE source IS NOT NULL AND TRIM(source) <> '' AND verified_at IS NOT NULL AND TRIM(verified_at) <> ''",
    ]
    out = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", shell=(sys.platform == "win32"))
    raw = out.stdout
    if "[" not in raw:
        sys.exit(f"Could not read vocabulary:\n{out.stderr or raw}")
    return json.loads(raw[raw.index("["):])[0]["results"]


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9 ]+", " ", s.lower().replace("'", "")).strip()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--prod", action="store_true", help="sweep production (spends free-tier quota)")
    ap.add_argument("--base", help="override the API base URL")
    ap.add_argument("--parallel", type=int, default=None, help="concurrent requests")
    args = ap.parse_args()

    base = args.base or (PROD if args.prod else LOCAL)
    parallel = args.parallel or (2 if args.prod else 6)
    if args.prod:
        print("WARNING: sweeping PRODUCTION. This spends Workers AI allowance and writes a")
        print("knowledge_gaps row per miss. Ctrl+C within 5s to abort.")
        import time
        time.sleep(5)

    rows = load_vocabulary(remote=args.prod)
    by_eng: dict[str, set[str]] = {}
    for r in rows:
        try:
            ts = json.loads(r["translations"] or "[]")
        except json.JSONDecodeError:
            continue
        for t in ts:
            t = str(t).strip()
            if t and len(t.split()) <= 3 and "(" not in t:
                by_eng.setdefault(norm(t), set()).add(r["headword"])

    def ask(eng: str) -> tuple[str, str]:
        req = urllib.request.Request(
            base + "/chat/new", data=json.dumps({"query": f"{eng} in ga"}).encode(), headers=HEADERS
        )
        try:
            return eng, json.load(urllib.request.urlopen(req, timeout=60))["response"]
        except Exception as e:  # counted separately, never as a miss
            return eng, f"ERR {e}"

    ok = miss = wrong = err = 0
    wrong_ex: list[str] = []
    miss_ex: list[str] = []
    err_ex: list[str] = []
    with cf.ThreadPoolExecutor(parallel) as ex:
        for eng, resp in ex.map(ask, sorted(by_eng)):
            if resp.startswith("ERR"):
                err += 1
                err_ex.append(resp[:70])
                continue
            m = re.search(r"\*\*(.+?)\*\*", resp)
            if "don't have" in resp or "don't know" in resp or not m:
                miss += 1
                miss_ex.append(eng)
            elif m.group(1) in by_eng[eng]:
                ok += 1
            else:
                wrong += 1
                wrong_ex.append(f"{eng} -> {m.group(1)}")

    n = ok + miss + wrong
    print(f"{base}")
    print(f"  {n} terms | correct {ok} ({100 * ok // max(n, 1)}%) | not found {miss} | WRONG {wrong} | errors {err}")
    if err:
        print(f"  errors are excluded from the counts — first: {err_ex[0]}")
    if wrong_ex:
        print("  wrong: " + "; ".join(wrong_ex))
    if miss_ex:
        print("  missed: " + ", ".join(miss_ex[:25]) + (" ..." if len(miss_ex) > 25 else ""))
    if err and not n:
        print("  every request errored — the result says nothing about lookup quality")
        return 2
    return 1 if wrong else 0


if __name__ == "__main__":
    sys.exit(main())
