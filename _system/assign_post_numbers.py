#!/usr/bin/env python3
"""
Permanent review numbers for Label Padho.

Runs automatically on GitHub before every build (see .github/workflows/pages.yml).
You never need to run it yourself.

Every review in _posts gets a permanent number (post_id). The number is what
the page address (/posts/12/), votes and views are all attached to, so the
file name, title and product name can change freely without losing anything.

Rules:
  * A new review gets the next unused number.
  * A number is never changed, even if someone edits or deletes it in the
    file. It is written back automatically.
  * Renaming or moving a review file keeps its number, even if the number
    line was also changed or deleted in the same commit (the file is matched
    to its previous version by content, using Git history).
  * Copying an existing review to start a new one gives the copy a new number.
  * Numbers of deleted reviews are retired and never reused. Restoring the
    deleted file (same file name) brings its number back.

The record of every number ever issued lives in _system/post-numbers.json.
Don't edit that file by hand.
"""
import datetime
import difflib
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POSTS_DIR = os.path.join(ROOT, "_posts")
REGISTRY_PATH = os.path.join(ROOT, "_system", "post-numbers.json")

POST_NAME_RE = re.compile(r"^\d{4}-\d{1,2}-\d{1,2}-.+\.(md|markdown|html)$", re.IGNORECASE)
ID_LINE_RE = re.compile(r"""^post_id\s*:\s*["']?(\d{1,9})["']?\s*(#.*)?$""")
MANAGED_LINE_RE = re.compile(r"^(post_id|permalink)\s*:")
MANAGED_COMMENT = "# Permanent review number, managed automatically. Do not edit the next two lines."
FENCE_RE = re.compile(r"^---\s*$")
CLOSE_RE = re.compile(r"^(---|\.\.\.)\s*$")

RENAME_SIMILARITY = 0.75  # how alike a renamed file must be to its old version

TODAY = datetime.date.today().isoformat()
log = []


def rel(path):
    return os.path.relpath(path, ROOT).replace(os.sep, "/")


def find_posts():
    found = []
    if not os.path.isdir(POSTS_DIR):
        return found
    for folder, dirs, files in os.walk(POSTS_DIR):
        dirs[:] = sorted(d for d in dirs if not d.startswith("."))
        for name in sorted(files):
            if POST_NAME_RE.match(name):
                found.append(rel(os.path.join(folder, name)))
    return sorted(found)


def read_post(path):
    """Return (lines, newline, front_matter_end_index, trailing_newline) or None."""
    with open(os.path.join(ROOT, path), "rb") as fh:
        raw = fh.read()
    text = raw.decode("utf-8-sig")
    newline = "\r\n" if "\r\n" in text else "\n"
    trailing = text.endswith("\n")
    lines = text.splitlines()
    if not lines or not FENCE_RE.match(lines[0]):
        return None
    for i in range(1, len(lines)):
        if CLOSE_RE.match(lines[i]):
            return lines, newline, i, trailing
    return None


def current_id(parsed):
    lines, _, end, _ = parsed
    for line in lines[1:end]:
        m = ID_LINE_RE.match(line)
        if m:
            return int(m.group(1))
    return None


def write_id(path, parsed, post_id):
    lines, newline, end, trailing = parsed
    front = [l for l in lines[1:end] if not MANAGED_LINE_RE.match(l) and l.strip() != MANAGED_COMMENT]
    managed = [MANAGED_COMMENT, "post_id: %d" % post_id, "permalink: /posts/%d/" % post_id]
    new_lines = [lines[0]] + managed + front + lines[end:]
    new_text = newline.join(new_lines) + (newline if trailing else "")
    full = os.path.join(ROOT, path)
    with open(full, "rb") as fh:
        old = fh.read()
    if new_text.encode("utf-8") != old:
        with open(full, "wb") as fh:
            fh.write(new_text.encode("utf-8"))
        return True
    return False


def normalise(text):
    """Content used for rename matching: managed lines removed, whitespace tidied."""
    lines = [l.rstrip() for l in text.replace("\r\n", "\n").split("\n")]
    lines = [l for l in lines if not MANAGED_LINE_RE.match(l) and l.strip() != MANAGED_COMMENT]
    return "\n".join(l for l in lines if l.strip())


def git(*args):
    try:
        out = subprocess.run(["git"] + list(args), cwd=ROOT, capture_output=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return None
    return out.stdout if out.returncode == 0 else None


def previous_content(path):
    """Last committed version of a file that no longer exists, from Git history."""
    commit = git("log", "-n", "1", "--format=%H", "--", path)
    if not commit or not commit.strip():
        return None
    commit = commit.decode().strip()
    blob = git("show", "%s:%s" % (commit, path)) or git("show", "%s^:%s" % (commit, path))
    if blob is None:
        return None
    return normalise(blob.decode("utf-8-sig", errors="replace"))


def similarity(a, b):
    matcher = difflib.SequenceMatcher(None, a, b, autojunk=False)
    if matcher.real_quick_ratio() < RENAME_SIMILARITY or matcher.quick_ratio() < RENAME_SIMILARITY:
        return 0.0
    return matcher.ratio()


def load_registry():
    if not os.path.exists(REGISTRY_PATH):
        return {"next_id": 1, "posts": {}}
    with open(REGISTRY_PATH, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    data.setdefault("posts", {})
    highest = max([int(k) for k in data["posts"]] or [0])
    data["next_id"] = max(int(data.get("next_id", 1)), highest + 1)
    return data


def save_registry(reg):
    ordered = {
        "_note": "Every review number ever issued. Managed automatically by _system/assign_post_numbers.py. Do not edit.",
        "next_id": reg["next_id"],
        "posts": {k: reg["posts"][k] for k in sorted(reg["posts"], key=int)},
    }
    text = json.dumps(ordered, indent=2, ensure_ascii=False) + "\n"
    old = None
    if os.path.exists(REGISTRY_PATH):
        with open(REGISTRY_PATH, "r", encoding="utf-8") as fh:
            old = fh.read()
    if text != old:
        os.makedirs(os.path.dirname(REGISTRY_PATH), exist_ok=True)
        with open(REGISTRY_PATH, "w", encoding="utf-8") as fh:
            fh.write(text)


def main():
    reg = load_registry()
    entries = reg["posts"]
    paths = find_posts()
    present = set(paths)

    parsed = {}
    for p in paths:
        result = read_post(p)
        if result is None:
            log.append("SKIPPED %s: no front matter (--- lines at the top), so Jekyll won't publish it either." % p)
        else:
            parsed[p] = result
    paths = [p for p in paths if p in parsed]

    active_by_file = {e["file"]: int(k) for k, e in entries.items() if e.get("status") == "active"}
    final = {}
    claimed = set()

    # 1. Files already on record keep their number, whatever the file now says.
    for p in paths:
        if p in active_by_file:
            final[p] = active_by_file[p]
            claimed.add(final[p])

    # 2. Renamed/moved files, and restored deleted files.
    for p in paths:
        if p in final:
            continue
        fid = current_id(parsed[p])
        entry = entries.get(str(fid)) if fid is not None else None
        if entry is None or fid in claimed:
            continue
        renamed = entry.get("status") == "active" and entry["file"] not in present
        restored = entry.get("status") == "deleted" and entry["file"] == p
        if renamed or restored:
            final[p] = fid
            claimed.add(fid)
            if renamed:
                log.append("Kept No. %d for renamed file %s (was %s)." % (fid, p, entry["file"]))
            else:
                log.append("Restored No. %d for %s." % (fid, p))

    # 2b. Renamed files whose number line was ALSO edited or removed:
    #     match missing reviews to unclaimed files by content (Git history).
    orphans = [int(k) for k, e in entries.items()
               if e.get("status") == "active" and e["file"] not in present and int(k) not in claimed]
    unclaimed = [p for p in paths if p not in final]
    if orphans and unclaimed:
        texts = {}
        for p in unclaimed:
            lines, _, _, _ = parsed[p]
            texts[p] = normalise("\n".join(lines))
        pairs = []
        for oid in orphans:
            old = previous_content(entries[str(oid)]["file"])
            if not old:
                continue
            for p in unclaimed:
                score = similarity(old, texts[p])
                if score >= RENAME_SIMILARITY:
                    pairs.append((score, oid, p))
        for score, oid, p in sorted(pairs, key=lambda t: (-t[0], t[1], t[2])):
            if oid in claimed or p in final:
                continue
            final[p] = oid
            claimed.add(oid)
            log.append("Kept No. %d for renamed file %s (was %s; matched by content, %d%% alike)."
                       % (oid, p, entries[str(oid)]["file"], round(score * 100)))

    # 3. Everything else is a new review and gets the next number.
    for p in paths:
        if p in final:
            continue
        new_id = reg["next_id"]
        reg["next_id"] += 1
        final[p] = new_id
        claimed.add(new_id)
        fid = current_id(parsed[p])
        if fid is not None:
            log.append("Assigned No. %d to %s (its post_id %d belongs to another review or was never issued)." % (new_id, p, fid))
        else:
            log.append("Assigned No. %d to new review %s." % (new_id, p))
        entries[str(new_id)] = {"file": p, "status": "active", "assigned": TODAY}

    # Update records: current file locations, and retire removed reviews.
    for p, pid in final.items():
        entry = entries[str(pid)]
        entry["file"] = p
        if entry.get("status") != "active":
            entry["status"] = "active"
            entry.pop("deleted", None)
    for key, entry in entries.items():
        if entry.get("status") == "active" and int(key) not in claimed:
            entry["status"] = "deleted"
            entry["deleted"] = TODAY
            log.append("Retired No. %s (%s was deleted). This number will never be reused." % (key, entry["file"]))

    # Write numbers into files (restores any edited or removed post_id).
    for p in paths:
        before = current_id(parsed[p])
        if write_id(p, parsed[p], final[p]) and (p in active_by_file or before not in (None, final[p])):
            if before == final[p]:
                log.append("Tidied the post_id/permalink lines in %s (No. %d)." % (p, final[p]))
            elif before is None:
                log.append("Restored No. %d in %s (its post_id line was removed)." % (final[p], p))
            else:
                log.append("Restored No. %d in %s (it had been changed to %d)." % (final[p], p, before))

    save_registry(reg)

    summary = ["%d reviews, next new review gets No. %d." % (len(paths), reg["next_id"])] + log
    for line in summary:
        print(line)
    summary_file = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_file:
        with open(summary_file, "a", encoding="utf-8") as fh:
            fh.write("### Review numbers\n\n" + "\n".join("- " + l for l in summary) + "\n")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # make failures readable in the Actions log
        print("Review numbering failed: %s" % exc, file=sys.stderr)
        raise
