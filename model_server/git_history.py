"""Resolve history selections once so cache keys and Git traversal agree."""
import subprocess


def git_text(directory, *args):
    proc = subprocess.run(['git', *args], cwd=directory, capture_output=True,
                          text=True, encoding='utf-8', errors='replace')
    if proc.returncode:
        raise ValueError((proc.stderr or proc.stdout or 'Git command failed').strip())
    return proc.stdout.strip()


def resolve_commit(directory, ref):
    return git_text(directory, 'rev-parse', '--verify', '--end-of-options', f'{ref}^{{commit}}')


def resolve_history(directory, base, head, mode):
    if mode == 'branch':
        return '', resolve_commit(directory, 'HEAD')
    if mode == 'working_tree':
        return '', ''
    if mode != 'custom':
        raise ValueError('Unknown diff range mode')
    if not base:
        raise ValueError('Choose a From revision for a custom range')
    return resolve_commit(directory, base), resolve_commit(directory, head or 'HEAD')


def history_log_args(base, head, first_parent):
    # --root includes the initial commit. First-parent retains merge commits,
    # representing each merge against its first parent, without side commits.
    args = ['--root', '--diff-merges=first-parent']
    if first_parent:
        args.append('--first-parent')
    args.append(f'{base}..{head}' if base else head)
    return args
