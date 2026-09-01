"""Read-only Git snapshots and unified hunks. No repository code is executed."""
from __future__ import annotations

import difflib
import fnmatch
import os
from pathlib import Path
import re
import stat
import subprocess
from dataclasses import dataclass, field

MAX_FILE_BYTES = 1024 * 1024
MAX_TOTAL_BYTES = 32 * 1024 * 1024
SUPPORTED = {".py", ".java", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"}


class SearchError(Exception):
    pass


def validate_ref(value: str) -> str:
    value = value.strip()
    if not value or value.startswith("-") or re.search(r"[\s\x00-\x1f]", value):
        raise SearchError("ブランチ名・タグ・コミットIDを指定してください。")
    return value


def matches_path(name: str, patterns: str) -> bool:
    values = [p.strip() for p in patterns.split(",") if p.strip()]
    return not values or any(
        fnmatch.fnmatchcase(name, p) or (p.startswith("**/") and fnmatch.fnmatchcase(name, p[3:]))
        for p in values
    )


@dataclass
class Snapshot:
    old_path: str | None
    new_path: str | None
    old_text: str
    new_text: str
    base: str
    head: str
    commit: str = ""
    subject: str = ""

    @property
    def path(self):
        return self.new_path or self.old_path or ""


def make_hunks(snapshot: Snapshot, context: int = 3) -> list[dict]:
    """Build hunks and changed line numbers together, avoiding patch-header ambiguity."""
    before = snapshot.old_text.splitlines()
    after = snapshot.new_text.splitlines()
    matcher = difflib.SequenceMatcher(None, before, after, autojunk=True)
    hunks = []
    for group in matcher.get_grouped_opcodes(context):
        a0, a1 = group[0][1], group[-1][2]
        b0, b1 = group[0][3], group[-1][4]
        old_start = a0 + 1 if a1 > a0 else a0
        new_start = b0 + 1 if b1 > b0 else b0
        header = f"@@ -{old_start},{a1-a0} +{new_start},{b1-b0} @@"
        lines, added, removed = [], [], []
        for tag, i1, i2, j1, j2 in group:
            if tag == "equal":
                lines.extend(" " + value for value in before[i1:i2])
            if tag in {"replace", "delete"}:
                lines.extend("-" + value for value in before[i1:i2])
                removed.extend(range(i1 + 1, i2 + 1))
            if tag in {"replace", "insert"}:
                lines.extend("+" + value for value in after[j1:j2])
                added.extend(range(j1 + 1, j2 + 1))
        old_label = "a/" + snapshot.old_path if snapshot.old_path else "/dev/null"
        new_label = "b/" + snapshot.new_path if snapshot.new_path else "/dev/null"
        patch = "\n".join([f"--- {old_label}", f"+++ {new_label}", header, *lines])
        hunks.append({
            "title": header,
            "text": patch,
            "code": "\n".join([header, *lines]),
            "old_line": removed[0] if removed else max(1, old_start),
            "new_line": added[0] if added else max(1, new_start),
            "added": added,
            "removed": removed,
            "side": "new" if added else "old",
        })
    # A trailing-newline-only change is still a textual change.
    if not hunks and snapshot.old_text != snapshot.new_text:
        last = after[-1] if after else ""
        line = max(1, len(after))
        patch = f"--- a/{snapshot.old_path}\n+++ b/{snapshot.new_path}\n@@ -{line},1 +{line},1 @@\n-{last}\n+{last}\n\\ Line ending or end-of-file newline changed"
        hunks.append({"title": "Line ending / final newline", "text": patch, "code": patch,
                      "old_line": line, "new_line": line, "added": [line],
                      "removed": [line], "side": "new"})
    return hunks


class Repository:
    def __init__(self, directory: str, git: str = "git"):
        self.git = git
        self.root = Path(directory).resolve()
        root = self.run("rev-parse", "--show-toplevel").decode("utf-8").strip()
        self.root = Path(root).resolve()
        self.warnings: list[str] = []

    def run(self, *args: str, allow_failure: bool = False) -> bytes:
        env = dict(os.environ)
        for key in ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"):
            env.pop(key, None)
        env.update({"GIT_OPTIONAL_LOCKS": "0", "GIT_TERMINAL_PROMPT": "0"})
        try:
            result = subprocess.run(
                [self.git, "--no-optional-locks", "--literal-pathspecs",
                 "-c", "core.quotepath=false", *args],
                cwd=self.root, env=env, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, timeout=45,
            )
        except FileNotFoundError as error:
            raise SearchError("Git が見つかりません。Git をインストールしてください。") from error
        except subprocess.TimeoutExpired as error:
            raise SearchError("Git の処理がタイムアウトしました。比較範囲を狭くしてください。") from error
        if result.returncode and not allow_failure:
            detail = result.stderr.decode("utf-8", "replace").strip()
            raise SearchError(detail or "Git の処理に失敗しました。")
        return result.stdout if result.returncode == 0 else b""

    def resolve(self, value: str) -> str:
        value = validate_ref(value)
        result = self.run("rev-parse", "--verify", "--end-of-options", value + "^{commit}", allow_failure=True)
        if not result:
            raise SearchError(f"参照が見つかりません: {value}（ローカルに存在する参照を指定してください）")
        return result.decode("ascii").strip()

    def head(self) -> str:
        return self.run("rev-parse", "--verify", "HEAD", allow_failure=True).decode("ascii").strip()

    def refs(self) -> list[dict]:
        result = []
        refs = self.run("for-each-ref", "--format=%(refname:short)\t%(objectname)",
                        "refs/heads", "refs/remotes", "refs/tags").decode("utf-8", "replace")
        for line in refs.splitlines():
            ref, _, oid = line.partition("\t")
            result.append({"ref": ref, "label": ref, "description": oid[:8]})
        if self.head():
            log = self.run("log", "-100", "--format=%H\t%h\t%s").decode("utf-8", "replace")
            for line in log.splitlines():
                fields = line.split("\t", 2)
                if len(fields) == 3:
                    result.append({"ref": fields[0], "label": fields[1] + "  " + fields[2],
                                   "description": "commit"})
        return result

    def _changes(self, base: str, head: str) -> list[tuple[str, str | None, str | None]]:
        options = ["--no-ext-diff", "--no-textconv", "--name-status", "-z", "--find-renames"]
        if not base and head:
            raw = self.run("diff-tree", "--root", "--no-commit-id", "-r", *options, head, "--")
        elif not base and not head:
            paths = self.run("ls-files", "--cached", "--others", "--exclude-standard", "-z").split(b"\0")
            return [("A", None, p.decode("utf-8")) for p in dict.fromkeys(paths) if p]
        else:
            raw = self.run("diff", *options, base, *([head] if head else []), "--")
        tokens = raw.split(b"\0")
        changes, i = [], 0
        while i < len(tokens) and tokens[i]:
            status_code = tokens[i].decode("ascii")
            i += 1
            if i >= len(tokens):
                raise SearchError("Git の変更一覧を読み取れませんでした。")
            try:
                first = tokens[i].decode("utf-8")
                i += 1
                if status_code.startswith(("R", "C")):
                    second = tokens[i].decode("utf-8")
                    i += 1
                    changes.append((status_code, first, second))
                else:
                    changes.append((status_code,
                                    None if status_code.startswith("A") else first,
                                    None if status_code.startswith("D") else first))
            except UnicodeDecodeError:
                self.warnings.append("UTF-8 以外のファイル名を除外しました。")
        return changes

    def _blob(self, ref: str, name: str | None) -> str:
        if not ref or name is None:
            return ""
        spec = f"{ref}:{name}"
        # ls-tree also distinguishes blobs from submodules and symlinks.
        entry = self.run("ls-tree", "-z", ref, "--", name)
        if not entry:
            return ""
        mode, kind, rest = entry.split(b" ", 2)
        if kind != b"blob" or mode == b"120000":
            raise SearchError("シンボリックリンクまたはサブモジュール")
        size = int(self.run("cat-file", "-s", spec).strip())
        if size > MAX_FILE_BYTES:
            raise SearchError("1 MB を超えるファイル")
        return self._decode(self.run("cat-file", "blob", spec))

    @staticmethod
    def _decode(raw: bytes) -> str:
        if b"\x00" in raw:
            raise SearchError("バイナリファイル")
        try:
            return raw.decode("utf-8-sig")
        except UnicodeDecodeError as error:
            raise SearchError("UTF-8 以外のファイル") from error

    def _working_file(self, name: str | None) -> str:
        if name is None:
            return ""
        candidate = self.root / name
        try:
            info = candidate.lstat()
        except FileNotFoundError:
            return ""
        if not stat.S_ISREG(info.st_mode) or not candidate.resolve().is_relative_to(self.root):
            raise SearchError("シンボリックリンク、特殊ファイル、またはリポジトリ外のファイル")
        if info.st_size > MAX_FILE_BYTES:
            raise SearchError("1 MB を超えるファイル")
        # Read a bounded amount, including files growing during the search.
        with candidate.open("rb") as stream:
            raw = stream.read(MAX_FILE_BYTES + 1)
        if len(raw) > MAX_FILE_BYTES:
            raise SearchError("1 MB を超えるファイル")
        return self._decode(raw)

    def snapshots(self, request: dict, progress=lambda text: None) -> tuple[list[Snapshot], dict]:
        mode = request.get("comparison", "working")
        base_input = str(request.get("base", "")).strip()
        head_input = str(request.get("head", "")).strip()
        max_files = max(1, min(2000, int(request.get("max_files", 300))))
        max_commits = max(1, min(1000, int(request.get("max_commits", 100))))
        include, exclude = str(request.get("include", "")), str(request.get("exclude", ""))
        if mode not in {"working", "range", "history"}:
            raise SearchError("比較方法が不正です。")
        base = self.resolve(base_input) if base_input else self.head()
        head = "" if mode == "working" else self.resolve(head_input or "HEAD")
        if mode != "working" and not base_input:
            raise SearchError("コミット比較では Base を指定してください。")
        pairs = []
        if mode == "history":
            commits = self.run("rev-list", "--topo-order", "--no-merges",
                               f"--max-count={max_commits+1}", f"{base}..{head}").decode("ascii").splitlines()
            if len(commits) > max_commits:
                raise SearchError(f"コミットが {max_commits} 件を超えます。範囲を狭めるか設定を変更してください。")
            for commit in commits:
                meta = self.run("show", "-s", "--format=%P%n%s", commit).decode("utf-8", "replace").splitlines()
                parent = meta[0].split()[0] if meta and meta[0] else ""
                subject = meta[1] if len(meta) > 1 else ""
                pairs.append((parent, commit, commit, subject))
        else:
            pairs.append((base, head, "", ""))
        snapshots, seen, total_bytes = [], 0, 0
        for old_ref, new_ref, commit, subject in pairs:
            changes = self._changes(old_ref, new_ref)
            if mode == "working" and not old_ref and not request.get("untracked", True):
                tracked = set(self.run("ls-files", "--cached", "-z").split(b"\0"))
                changes = [change for change in changes if (change[2] or "").encode("utf-8") in tracked]
            if mode == "working" and old_ref and request.get("untracked", True):
                for raw in self.run("ls-files", "--others", "--exclude-standard", "-z").split(b"\0"):
                    if raw:
                        try:
                            changes.append(("A", None, raw.decode("utf-8")))
                        except UnicodeDecodeError:
                            self.warnings.append("UTF-8 以外のファイル名を除外しました。")
            for status_code, old_path, new_path in changes:
                name = new_path or old_path or ""
                if not matches_path(name, include) or (exclude.strip() and matches_path(name, exclude)):
                    continue
                if request.get("target") == "functions" and Path(name).suffix.lower() not in SUPPORTED:
                    continue
                seen += 1
                if seen > max_files:
                    raise SearchError(f"対象が {max_files} ファイル変更を超えます。ファイル条件か比較範囲を絞ってください。")
                if status_code.startswith("U"):
                    raise SearchError(f"競合を解決してから検索してください: {name}")
                progress(f"差分を読み込み中: {seen} ファイル")
                try:
                    old_text = self._blob(old_ref, old_path)
                    new_text = self._blob(new_ref, new_path) if new_ref else self._working_file(new_path)
                except (SearchError, OSError) as error:
                    self.warnings.append(f"{name}: {error}")
                    continue
                total_bytes += len(old_text.encode("utf-8")) + len(new_text.encode("utf-8"))
                if total_bytes > MAX_TOTAL_BYTES:
                    raise SearchError("比較内容が 32 MB を超えます。ファイル条件か比較範囲を絞ってください。")
                if old_text == new_text:
                    if old_path != new_path or status_code.startswith("T"):
                        self.warnings.append(f"{name}: 本文に変更のない名前・種類の変更")
                    continue
                snapshots.append(Snapshot(old_path, new_path, old_text, new_text,
                                          old_ref, new_ref, commit, subject))
        return snapshots, {
            "base": base, "head": head, "comparison": mode,
            "files": len(snapshots), "commits": len(pairs) if mode == "history" else 0,
            "warnings": self.warnings[:30],
            "warning_count": len(self.warnings),
        }
