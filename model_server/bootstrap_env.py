#!/usr/bin/env python3
"""Utility for bootstrapping the OwlSpotlight Python environment with uv."""
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
            "Python version or interpreter path for uv to use when creating the virtual "
            "environment. Defaults to the current interpreter's major.minor version."
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
        help="Deprecated with uv. Accepted for compatibility but ignored.",
    )
    return parser.parse_args()


def run_command(cmd: Iterable[str], *, env: dict[str, str] | None = None) -> None:
    display_cmd = " ".join(str(part) for part in cmd)
    print(f"\n[bootstrap] $ {display_cmd}")
    subprocess.check_call([str(part) for part in cmd], env=env)


def ensure_uv() -> str:
    uv_path = shutil.which("uv")
    if uv_path:
        return uv_path
    raise SystemExit(
        "uv was not found in PATH. Install it from https://docs.astral.sh/uv/getting-started/installation/"
    )


def venv_bin_path(env_dir: Path, executable: str) -> Path:
    if platform.system() == "Windows":
        if executable == "python":
            return env_dir / "Scripts" / "python.exe"
        return env_dir / "Scripts" / f"{executable}.exe"
    return env_dir / "bin" / executable


def current_python_spec() -> str:
    return f"{sys.version_info.major}.{sys.version_info.minor}"


def main() -> None:
    args = parse_args()
    ensure_uv()

    project_root = Path(__file__).resolve().parent
    env_dir = (project_root / args.env_dir).resolve()

    python_spec = args.python or current_python_spec()

    if env_dir.exists() and args.force_recreate:
        print(f"[bootstrap] Removing existing environment at {env_dir}")
        shutil.rmtree(env_dir)

    if not env_dir.exists():
        print(f"[bootstrap] Creating virtual environment at {env_dir} with uv")
        run_command(["uv", "venv", "--python", python_spec, str(env_dir)])
    else:
        print(f"[bootstrap] Reusing existing environment at {env_dir}")

    python_env_path = venv_bin_path(env_dir, "python")

    requirements_path = (project_root / args.requirements).resolve()
    if not requirements_path.exists():
        raise SystemExit(f"Requirements file not found: {requirements_path}")
    run_command(["uv", "pip", "install", "--python", str(python_env_path), "-r", str(requirements_path)])

    if args.torch_mode == "cpu":
        torch_requirements = (project_root / args.torch_requirements).resolve()
        if not torch_requirements.exists():
            raise SystemExit(f"Torch requirements file not found: {torch_requirements}")
        run_command(
            ["uv", "pip", "install", "--python", str(python_env_path), "-r", str(torch_requirements)]
        )
    elif args.torch_mode == "cuda":
        run_command(
            [
                "uv",
                "pip",
                "install",
                "--python",
                str(python_env_path),
                "torch",
                "--index-url",
                args.torch_index,
            ]
        )
    else:
        print("[bootstrap] Skipping PyTorch installation as requested")

    if args.skip_pip_upgrade:
        print("[bootstrap] --skip-pip-upgrade is ignored because uv manages package installation directly")

    print(
        "\n[bootstrap] Environment ready! Activate it with:\n"
        f"  {python_env_path.parent / ('activate.bat' if platform.system() == 'Windows' else 'activate')}"
    )
    print(
        f"[bootstrap] Afterwards run '{python_env_path} -m uvicorn server:app --host 127.0.0.1 --port 8000'."
    )


if __name__ == "__main__":
    main()
