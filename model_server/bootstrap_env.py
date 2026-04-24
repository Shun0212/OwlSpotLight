#!/usr/bin/env python3
"""Utility for bootstrapping the OwlSpotlight Python environment with uv."""
from __future__ import annotations

import argparse
import os
import platform
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Iterable


CUDA_12_8_TORCH_INDEX = "https://download.pytorch.org/whl/cu128"
CUDA_12_4_TORCH_INDEX = "https://download.pytorch.org/whl/cu124"
DEFAULT_TORCH_INDEX = CUDA_12_8_TORCH_INDEX
CUDA_12_X_MIN_DRIVER = "527.41"
CUDA_12_8_RECOMMENDED_DRIVER = "570.0"


def get_uv_candidate_paths() -> list[Path]:
    home = Path.home()
    candidates: list[Path] = []

    if platform.system() == "Windows":
        candidates.extend(
            [
                home / ".local" / "bin" / "uv.exe",
                home / "AppData" / "Local" / "Programs" / "uv" / "uv.exe",
            ]
        )
        local_app_data = os.environ.get("LOCALAPPDATA")
        if local_app_data:
            candidates.append(
                Path(local_app_data)
                / "Microsoft"
                / "WinGet"
                / "Packages"
                / "astral-sh.uv_Microsoft.Winget.Source_8wekyb3d8bbwe"
                / "uv.exe"
            )
    else:
        candidates.extend(
            [
                home / ".local" / "bin" / "uv",
                home / ".cargo" / "bin" / "uv",
            ]
        )

    return candidates


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
        choices=("auto", "cpu", "cuda", "skip"),
        default="cpu",
        help=(
            "Choose how PyTorch should be installed: 'auto' detects the best supported build "
            "for the current NVIDIA driver, 'cpu' installs the standard build defined in "
            "requirements/torch-cpu.txt, 'cuda' installs from the specified CUDA wheel index, "
            "and 'skip' leaves PyTorch uninstalled."
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


def run_best_effort_command(cmd: Iterable[str], *, env: dict[str, str] | None = None) -> None:
    display_cmd = " ".join(str(part) for part in cmd)
    print(f"\n[bootstrap] $ {display_cmd}")
    subprocess.run([str(part) for part in cmd], env=env, check=False)


def uninstall_existing_torch_packages(uv_path: str, python_env_path: Path) -> None:
    run_best_effort_command(
        [
            uv_path,
            "pip",
            "uninstall",
            "--python",
            str(python_env_path),
            "torch",
            "torchvision",
            "torchaudio",
        ]
    )


def install_cpu_torch(uv_path: str, python_env_path: Path, torch_requirements: Path) -> None:
    uninstall_existing_torch_packages(uv_path, python_env_path)
    run_command(
        [uv_path, "pip", "install", "--python", str(python_env_path), "-r", str(torch_requirements)]
    )


def install_cuda_torch(uv_path: str, python_env_path: Path, torch_index: str) -> None:
    uninstall_existing_torch_packages(uv_path, python_env_path)
    run_command(
        [
            uv_path,
            "pip",
            "install",
            "--python",
            str(python_env_path),
            "--reinstall",
            "torch",
            "--index-url",
            torch_index,
        ]
    )


def validate_torch_import(python_env_path: Path) -> tuple[bool, str]:
    result = subprocess.run(
        [str(python_env_path), "-c", "import torch; print(torch.__version__)"],
        capture_output=True,
        text=True,
        check=False,
    )

    if result.returncode == 0:
        version = result.stdout.strip() or "unknown"
        return True, f"PyTorch import succeeded ({version})."

    stderr = (result.stderr or "").strip()
    stdout = (result.stdout or "").strip()
    detail = stderr or stdout or f"python exited with code {result.returncode}"
    return False, detail


def parse_version(version: str) -> tuple[int, ...]:
    parts = re.split(r"[^0-9]+", version.strip())
    return tuple(int(part) for part in parts if part)


def compare_versions(left: str, right: str) -> int:
    left_parts = parse_version(left)
    right_parts = parse_version(right)
    max_length = max(len(left_parts), len(right_parts))

    for index in range(max_length):
        left_part = left_parts[index] if index < len(left_parts) else 0
        right_part = right_parts[index] if index < len(right_parts) else 0
        if left_part > right_part:
            return 1
        if left_part < right_part:
            return -1

    return 0


def detect_nvidia_driver_version() -> tuple[str | None, str | None]:
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,driver_version", "--format=csv,noheader"],
            capture_output=True,
            text=True,
            check=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError):
        return None, None

    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    if not lines:
        return None, None

    first_line = lines[0]
    parts = [part.strip() for part in first_line.split(",", maxsplit=1)]
    if len(parts) != 2:
        return None, None

    gpu_name, driver_version = parts
    return gpu_name or None, driver_version or None


def resolve_auto_torch_installation() -> tuple[str, str | None]:
    gpu_name, driver_version = detect_nvidia_driver_version()

    if not driver_version:
        print("[bootstrap] No NVIDIA GPU detected via nvidia-smi; using the CPU PyTorch build.")
        return "cpu", None

    print(f"[bootstrap] Detected NVIDIA GPU: {gpu_name or 'Unknown'} (driver {driver_version})")

    if compare_versions(driver_version, CUDA_12_8_RECOMMENDED_DRIVER) >= 0:
        print("[bootstrap] Auto-selected CUDA 12.8 PyTorch wheels for this driver.")
        return "cuda", CUDA_12_8_TORCH_INDEX

    if compare_versions(driver_version, CUDA_12_X_MIN_DRIVER) >= 0:
        print("[bootstrap] Auto-selected CUDA 12.4 PyTorch wheels for safer driver compatibility.")
        return "cuda", CUDA_12_4_TORCH_INDEX

    print(
        f"[bootstrap] NVIDIA driver {driver_version} is older than the supported CUDA 12.x range; "
        "using the CPU PyTorch build."
    )
    return "cpu", None


def ensure_uv() -> str:
    uv_path = shutil.which("uv")
    if uv_path:
        return uv_path
    for candidate in get_uv_candidate_paths():
        if candidate.is_file():
            return str(candidate)
    raise SystemExit(
        "uv was not found in PATH or common install locations. Install it from https://docs.astral.sh/uv/getting-started/installation/"
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
    uv_path = ensure_uv()

    project_root = Path(__file__).resolve().parent
    env_dir = (project_root / args.env_dir).resolve()

    python_spec = args.python or current_python_spec()

    if env_dir.exists() and args.force_recreate:
        print(f"[bootstrap] Removing existing environment at {env_dir}")
        shutil.rmtree(env_dir)

    if not env_dir.exists():
        print(f"[bootstrap] Creating virtual environment at {env_dir} with uv")
        run_command([uv_path, "venv", "--python", python_spec, str(env_dir)])
    else:
        print(f"[bootstrap] Reusing existing environment at {env_dir}")

    python_env_path = venv_bin_path(env_dir, "python")

    requirements_path = (project_root / args.requirements).resolve()
    if not requirements_path.exists():
        raise SystemExit(f"Requirements file not found: {requirements_path}")
    run_command([uv_path, "pip", "install", "--python", str(python_env_path), "-r", str(requirements_path)])

    selected_torch_mode = args.torch_mode
    selected_torch_index = args.torch_index
    torch_requirements = (project_root / args.torch_requirements).resolve()

    if args.torch_mode == "auto":
        selected_torch_mode, selected_torch_index = resolve_auto_torch_installation()

    if selected_torch_mode == "cpu":
        if not torch_requirements.exists():
            raise SystemExit(f"Torch requirements file not found: {torch_requirements}")
        install_cpu_torch(uv_path, python_env_path, torch_requirements)
    elif selected_torch_mode == "cuda":
        install_cuda_torch(uv_path, python_env_path, selected_torch_index or DEFAULT_TORCH_INDEX)

        import_ok, import_detail = validate_torch_import(python_env_path)
        if import_ok:
            print(f"[bootstrap] {import_detail}")
        elif args.torch_mode == "auto":
            if not torch_requirements.exists():
                raise SystemExit(f"Torch requirements file not found: {torch_requirements}")
            print("[bootstrap] CUDA PyTorch import failed after installation; falling back to the CPU build.")
            print(f"[bootstrap] Torch import error: {import_detail}")
            install_cpu_torch(uv_path, python_env_path, torch_requirements)
            cpu_import_ok, cpu_import_detail = validate_torch_import(python_env_path)
            if not cpu_import_ok:
                raise SystemExit(f"CPU PyTorch import failed after fallback: {cpu_import_detail}")
            print(f"[bootstrap] {cpu_import_detail}")
        else:
            raise SystemExit(
                "CUDA PyTorch import failed after installation. "
                f"Torch import error: {import_detail}"
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
