#!/usr/bin/env python3
"""Utility for bootstrapping the OwlSpotlight Python environment.

This script centralises the logic that used to live in the VS Code
extension so that contributors can reproduce the exact same setup from
any shell.  It creates a virtual environment, installs the base
requirements and optionally installs a GPU build of PyTorch.
"""
from __future__ import annotations

import argparse
import platform
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Iterable


DEFAULT_TORCH_INDEX = "https://download.pytorch.org/whl/cu128"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create a virtual environment for the OwlSpotlight model server",
    )
    parser.add_argument(
        "--python",
        default=None,
        help=(
            "Python interpreter to use for creating the virtual environment. "
            "Defaults to the interpreter that executes this script."
        ),
    )
    parser.add_argument(
        "--env-dir",
        default=".venv",
        help="Target directory for the virtual environment (default: .venv)",
    )
    parser.add_argument(
        "--requirements",
        default=Path("requirements") / "base.txt",
        type=Path,
        help=(
            "Requirements file to install inside the environment. "
            "Defaults to requirements/base.txt."
        ),
    )
    parser.add_argument(
        "--torch-mode",
        choices=("cpu", "cuda", "skip"),
        default="cpu",
        help=(
            "Choose how PyTorch should be installed: 'cpu' installs the standard build "
            "defined in requirements/torch-cpu.txt, 'cuda' installs from the official CUDA "
            "wheel index (defaulting to CUDA 12.8), and 'skip' leaves PyTorch uninstalled."
        ),
    )
    parser.add_argument(
        "--torch-index",
        default=DEFAULT_TORCH_INDEX,
        help=(
            "Custom index URL to use when --torch-mode=cuda. "
            "Defaults to the official PyTorch CUDA 12.8 wheel index."
        ),
    )
    parser.add_argument(
        "--torch-requirements",
        default=Path("requirements") / "torch-cpu.txt",
        type=Path,
        help=(
            "Requirements file that pins the CPU build of PyTorch. "
            "Used when --torch-mode=cpu."
        ),
    )
    parser.add_argument(
        "--force-recreate",
        action="store_true",
        help="Delete the existing virtual environment before creating a new one.",
    )
    parser.add_argument(
        "--skip-pip-upgrade",
        action="store_true",
        help="Do not run 'pip install --upgrade pip' inside the environment.",
    )
    return parser.parse_args()


def run_command(cmd: Iterable[str], *, env: dict[str, str] | None = None) -> None:
    display_cmd = " ".join(str(part) for part in cmd)
    print(f"\n[bootstrap] $ {display_cmd}")
    subprocess.check_call(list(str(part) for part in cmd), env=env)


def ensure_python(python_cmd: str) -> str:
    """Return the interpreter path and validate the version."""
    try:
        version_output = subprocess.check_output(
            [python_cmd, "-c", "import sys; print(sys.version)"],
            text=True,
        ).strip()
    except FileNotFoundError as exc:
        raise SystemExit(f"Python interpreter '{python_cmd}' was not found.") from exc
    except subprocess.CalledProcessError as exc:
        raise SystemExit(
            f"Failed to execute '{python_cmd}'. Please ensure Python 3.11 or newer is installed."
        ) from exc

    version_info = tuple(int(part) for part in version_output.split()[0].split(".")[:2])
    if version_info < (3, 11):
        raise SystemExit(
            f"Python 3.11 or newer is required. Detected version: {version_output}."
        )
    return python_cmd


def venv_bin_path(env_dir: Path, executable: str) -> Path:
    if platform.system() == "Windows":
        return env_dir / "Scripts" / executable
    return env_dir / "bin" / executable


def main() -> None:
    args = parse_args()
    project_root = Path(__file__).resolve().parent
    env_dir = (project_root / args.env_dir).resolve()

    python_cmd = args.python or sys.executable
    python_cmd = ensure_python(python_cmd)

    if env_dir.exists() and args.force_recreate:
        print(f"[bootstrap] Removing existing environment at {env_dir}")
        shutil.rmtree(env_dir)

    if not env_dir.exists():
        print(f"[bootstrap] Creating virtual environment at {env_dir}")
        run_command([python_cmd, "-m", "venv", str(env_dir)])
    else:
        print(f"[bootstrap] Reusing existing environment at {env_dir}")

    pip_path = venv_bin_path(env_dir, "pip")
    python_env_path = venv_bin_path(env_dir, "python")

    if not args.skip_pip_upgrade:
        run_command([pip_path, "install", "--upgrade", "pip"])

    requirements_path = (project_root / args.requirements).resolve()
    if not requirements_path.exists():
        raise SystemExit(f"Requirements file not found: {requirements_path}")
    run_command([pip_path, "install", "-r", str(requirements_path)])

    if args.torch_mode == "cpu":
        torch_requirements = (project_root / args.torch_requirements).resolve()
        if not torch_requirements.exists():
            raise SystemExit(f"Torch requirements file not found: {torch_requirements}")
        run_command([pip_path, "install", "-r", str(torch_requirements)])
    elif args.torch_mode == "cuda":
        run_command([pip_path, "install", "torch", "--index-url", args.torch_index])
    else:
        print("[bootstrap] Skipping PyTorch installation as requested")

    print(
        "\n[bootstrap] Environment ready! Activate it with:\n"
        f"  {python_env_path.parent / ('activate.bat' if platform.system() == 'Windows' else 'activate')}"
    )
    print("[bootstrap] Afterwards run 'uvicorn server:app --host 127.0.0.1 --port 8000 --reload'.")


if __name__ == "__main__":
    main()
