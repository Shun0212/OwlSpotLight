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
import json
from pathlib import Path
from typing import Any, Iterable


TORCH_BUILD_MATRIX_PATH = Path(__file__).resolve().parent / "torch_build_matrix.json"
DEFAULT_TORCH_BUILD_KEY = "cu128"

TorchBuildMatrix = dict[str, Any]
TorchBuildSpec = dict[str, Any]


def candidate_from_dir(directory: str | None, executable: str) -> Path | None:
    if not directory:
        return None
    trimmed = directory.strip()
    if not trimmed:
        return None
    candidate = Path(trimmed).expanduser()
    if candidate.name.lower() == executable.lower():
        return candidate
    return candidate / executable


def xdg_executable_candidates(executable: str) -> list[Path]:
    candidates: list[Path] = []

    xdg_bin_home = os.environ.get("XDG_BIN_HOME")
    if xdg_bin_home:
        candidates.append(Path(xdg_bin_home).expanduser() / executable)

    xdg_data_home = os.environ.get("XDG_DATA_HOME")
    if xdg_data_home:
        candidates.append((Path(xdg_data_home).expanduser() / ".." / "bin" / executable).resolve())

    return candidates


def get_windows_python_script_candidates(executable: str) -> list[Path]:
    base_dirs = [
        Path(os.environ["APPDATA"]) / "Python" if os.environ.get("APPDATA") else None,
        Path(os.environ["LOCALAPPDATA"]) / "Programs" / "Python" if os.environ.get("LOCALAPPDATA") else None,
    ]

    candidates: list[Path] = []
    for base_dir in base_dirs:
        if not base_dir or not base_dir.is_dir():
            continue

        try:
            for child in base_dir.iterdir():
                if not child.is_dir():
                    continue
                if not re.match(r"^Python\d+", child.name, re.IGNORECASE):
                    continue
                candidates.append(child / "Scripts" / executable)
        except OSError:
            continue

    return candidates


def get_uv_candidate_paths() -> list[Path]:
    home = Path.home()
    executable = "uv.exe" if platform.system() == "Windows" else "uv"
    candidates: list[Path] = []

    candidates.extend(xdg_executable_candidates(executable))

    for env_dir in (
        os.environ.get("UV_INSTALL_DIR"),
        os.environ.get("UV_UNMANAGED_INSTALL"),
        os.environ.get("PIPX_BIN_DIR"),
    ):
        candidate = candidate_from_dir(env_dir, executable)
        if candidate:
            candidates.append(candidate)

    if platform.system() == "Windows":
        candidates.extend(
            [
                home / ".local" / "bin" / executable,
                home / ".cargo" / "bin" / executable,
                home / "AppData" / "Local" / "Programs" / "uv" / executable,
                home / "scoop" / "shims" / executable,
            ]
        )
        local_app_data = os.environ.get("LOCALAPPDATA")
        if local_app_data:
            candidates.extend(
                [
                    Path(local_app_data) / "Microsoft" / "WinGet" / "Links" / executable,
                    Path(local_app_data)
                    / "Microsoft"
                    / "WinGet"
                    / "Packages"
                    / "astral-sh.uv_Microsoft.Winget.Source_8wekyb3d8bbwe"
                    / executable,
                ]
            )
        candidates.extend(get_windows_python_script_candidates(executable))
    else:
        candidates.extend(
            [
                home / ".local" / "bin" / executable,
                home / ".cargo" / "bin" / executable,
                Path("/opt/homebrew/bin") / executable,
                Path("/usr/local/bin") / executable,
                Path("/opt/local/bin") / executable,
                Path("/usr/bin") / executable,
            ]
        )

    deduped: list[Path] = []
    seen: set[str] = set()
    for candidate in candidates:
        key = str(candidate)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(candidate)

    return deduped


def load_torch_build_matrix() -> TorchBuildMatrix:
    with TORCH_BUILD_MATRIX_PATH.open("r", encoding="utf-8") as fh:
        matrix = json.load(fh)

    if not isinstance(matrix, dict):
        raise SystemExit(f"Invalid torch build matrix format: {TORCH_BUILD_MATRIX_PATH}")

    builds = matrix.get("builds")
    auto_selection_order = matrix.get("autoSelectionOrder")
    if not isinstance(builds, list) or not isinstance(auto_selection_order, list):
        raise SystemExit(f"Invalid torch build matrix contents: {TORCH_BUILD_MATRIX_PATH}")

    return matrix


def get_build_map(matrix: TorchBuildMatrix) -> dict[str, TorchBuildSpec]:
    return {
        build["key"]: build
        for build in matrix["builds"]
        if isinstance(build, dict) and isinstance(build.get("key"), str)
    }


def normalize_runtime_platform() -> str:
    system_name = platform.system()
    if system_name == "Windows":
        return "win32"
    if system_name == "Linux":
        return "linux"
    if system_name == "Darwin":
        return "darwin"
    return system_name.lower()


def normalize_runtime_architecture() -> str:
    machine = platform.machine().lower()
    if machine in {"x86_64", "amd64"}:
        return "x64"
    if machine in {"aarch64", "arm64"}:
        return "arm64"
    return machine


def build_supported_on_current_platform(build: TorchBuildSpec, platform_key: str, architecture: str) -> bool:
    supported_arches = build.get("supportedArchitectures", {})
    if not isinstance(supported_arches, dict):
        return False

    supported_for_platform = supported_arches.get(platform_key)
    if not isinstance(supported_for_platform, list):
        return False

    return architecture in supported_for_platform


def driver_requirement_for_platform(build: TorchBuildSpec, platform_key: str) -> str | None:
    driver_requirements = build.get("driverRequirements", {})
    if not isinstance(driver_requirements, dict):
        return None
    value = driver_requirements.get(platform_key)
    return value if isinstance(value, str) else None


def get_available_builds_for_current_platform(matrix: TorchBuildMatrix) -> list[TorchBuildSpec]:
    platform_key = normalize_runtime_platform()
    architecture = normalize_runtime_architecture()
    return [
        build
        for build in matrix["builds"]
        if build_supported_on_current_platform(build, platform_key, architecture)
    ]


def resolve_build_by_key(matrix: TorchBuildMatrix, build_key: str) -> TorchBuildSpec | None:
    return get_build_map(matrix).get(build_key)


def get_default_cuda_build(matrix: TorchBuildMatrix) -> TorchBuildSpec:
    build = resolve_build_by_key(matrix, DEFAULT_TORCH_BUILD_KEY)
    if build is None:
        raise SystemExit(f"Default torch build key '{DEFAULT_TORCH_BUILD_KEY}' not found in {TORCH_BUILD_MATRIX_PATH}")
    return build


def select_best_auto_build(matrix: TorchBuildMatrix, driver_version: str) -> TorchBuildSpec | None:
    platform_key = normalize_runtime_platform()
    architecture = normalize_runtime_architecture()
    build_map = get_build_map(matrix)

    for build_key in matrix["autoSelectionOrder"]:
        if not isinstance(build_key, str):
            continue

        build = build_map.get(build_key)
        if build is None or not build_supported_on_current_platform(build, platform_key, architecture):
            continue

        min_driver = driver_requirement_for_platform(build, platform_key)
        if min_driver and compare_versions(driver_version, min_driver) >= 0:
            return build

    return None


def resolve_torch_index(matrix: TorchBuildMatrix, build_key: str | None, override_index: str | None) -> tuple[str, TorchBuildSpec | None]:
    if build_key:
        build = resolve_build_by_key(matrix, build_key)
        if build is None:
            raise SystemExit(f"Unknown torch build key: {build_key}")
        return override_index or build["torchIndex"], build

    if override_index:
        return override_index, None

    default_build = get_default_cuda_build(matrix)
    return default_build["torchIndex"], default_build


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
        default=None,
        help=(
            "Custom index URL to use when --torch-mode=cuda. "
            "If omitted, OwlSpotlight resolves the index from --torch-build or the default matrix entry."
        ),
    )
    parser.add_argument(
        "--torch-build",
        default=None,
        help=(
            "Torch build key from torch_build_matrix.json, such as cu118, cu124, cu128, cu129, or cu130. "
            "Used for both manual installs and auto-selection logging."
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


def get_nvidia_smi_candidate_paths() -> list[Path]:
    candidates: list[Path] = []
    if platform.system() == "Windows":
        for env_name in ("PROGRAMFILES", "ProgramW6432", "ProgramFiles(x86)"):
            base_dir = os.environ.get(env_name)
            if not base_dir:
                continue
            candidates.append(Path(base_dir) / "NVIDIA Corporation" / "NVSMI" / "nvidia-smi.exe")

        system_root = os.environ.get("SYSTEMROOT")
        if system_root:
            candidates.append(Path(system_root) / "System32" / "nvidia-smi.exe")
    else:
        candidates.extend(
            [
                Path("/usr/bin/nvidia-smi"),
                Path("/usr/local/bin/nvidia-smi"),
                Path("/opt/bin/nvidia-smi"),
            ]
        )

    deduped: list[Path] = []
    seen: set[str] = set()
    for candidate in candidates:
        key = str(candidate)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(candidate)

    return deduped


def resolve_nvidia_smi() -> str | None:
    executable = "nvidia-smi.exe" if platform.system() == "Windows" else "nvidia-smi"
    resolved = shutil.which(executable) or shutil.which("nvidia-smi")
    if resolved:
        return resolved

    for candidate in get_nvidia_smi_candidate_paths():
        if candidate.is_file():
            return str(candidate)

    return None


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


def validate_torch_cuda_runtime(python_env_path: Path) -> tuple[bool, str]:
    validation_script = """
import json
import torch

payload = {
    "torch_version": getattr(torch, "__version__", "unknown"),
    "torch_cuda_version": getattr(getattr(torch, "version", None), "cuda", None),
    "cuda_available": bool(torch.cuda.is_available()),
}

if payload["cuda_available"]:
    payload["gpu_name"] = torch.cuda.get_device_name(0)

print(json.dumps(payload))
"""
    result = subprocess.run(
        [
            str(python_env_path),
            "-c",
            validation_script,
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    if result.returncode != 0:
        stderr = (result.stderr or "").strip()
        stdout = (result.stdout or "").strip()
        detail = stderr or stdout or f"python exited with code {result.returncode}"
        return False, detail

    payload_text = (result.stdout or "").strip()
    try:
        payload = json.loads(payload_text)
    except json.JSONDecodeError:
        return False, f"Could not parse CUDA validation output: {payload_text}"

    torch_version = payload.get("torch_version") or "unknown"
    torch_cuda_version = payload.get("torch_cuda_version")
    if payload.get("cuda_available"):
        gpu_name = payload.get("gpu_name") or "unknown GPU"
        return True, (
            f"PyTorch CUDA validation succeeded ({torch_version}, CUDA {torch_cuda_version or 'unknown'}, "
            f"GPU: {gpu_name})."
        )

    return False, (
        f"PyTorch imported ({torch_version}) but torch.cuda.is_available() returned false "
        f"(torch.version.cuda={torch_cuda_version!r})."
    )


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


def detect_nvidia_driver_version() -> tuple[str | None, str | None, str | None]:
    nvidia_smi = resolve_nvidia_smi()
    if not nvidia_smi:
        return None, None, None

    try:
        result = subprocess.run(
            [nvidia_smi, "--query-gpu=name,driver_version", "--format=csv,noheader"],
            capture_output=True,
            text=True,
            check=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError):
        return None, None, nvidia_smi

    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    if not lines:
        return None, None, nvidia_smi

    first_line = lines[0]
    parts = [part.strip() for part in first_line.split(",", maxsplit=1)]
    if len(parts) != 2:
        return None, None, nvidia_smi

    gpu_name, driver_version = parts
    return gpu_name or None, driver_version or None, nvidia_smi


def resolve_auto_torch_installation(matrix: TorchBuildMatrix) -> tuple[str, str | None, TorchBuildSpec | None]:
    if platform.system() == "Darwin":
        print(
            "[bootstrap] CUDA PyTorch wheels are not supported on macOS; using the CPU build. "
            "Apple Silicon can still use MPS acceleration at runtime."
        )
        return "cpu", None, None

    gpu_name, driver_version, detection_source = detect_nvidia_driver_version()

    if not driver_version:
        if gpu_name:
            print(
                f"[bootstrap] Detected {gpu_name}, but could not determine a compatible NVIDIA driver version"
                f"{f' from {detection_source}' if detection_source else ''}; using the CPU PyTorch build."
            )
        else:
            print(
                "[bootstrap] No NVIDIA GPU detected via nvidia-smi in PATH or common install locations; "
                "using the CPU PyTorch build."
            )
        return "cpu", None, None

    source_suffix = f" via {detection_source}" if detection_source else ""
    print(f"[bootstrap] Detected NVIDIA GPU: {gpu_name or 'Unknown'} (driver {driver_version}){source_suffix}")
    selected_build = select_best_auto_build(matrix, driver_version)
    if selected_build is not None:
        platform_key = normalize_runtime_platform()
        min_driver = driver_requirement_for_platform(selected_build, platform_key)
        print(
            f"[bootstrap] Auto-selected {selected_build['label']} "
            f"(build key {selected_build['key']}, min driver {min_driver or 'unknown'})."
        )
        return "cuda", selected_build["torchIndex"], selected_build

    print(
        f"[bootstrap] NVIDIA driver {driver_version} is older than the supported CUDA build matrix; "
        "using the CPU PyTorch build."
    )
    return "cpu", None, None


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
    matrix = load_torch_build_matrix()
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
    selected_torch_build = resolve_build_by_key(matrix, args.torch_build) if args.torch_build else None
    torch_requirements = (project_root / args.torch_requirements).resolve()

    if args.torch_mode == "auto":
        selected_torch_mode, selected_torch_index, selected_torch_build = resolve_auto_torch_installation(matrix)

    if selected_torch_mode == "cuda" and platform.system() == "Darwin":
        raise SystemExit(
            "CUDA PyTorch wheels are not supported on macOS. Use the CPU build instead; "
            "Apple Silicon can still use MPS acceleration at runtime."
        )

    if selected_torch_mode == "cpu":
        if not torch_requirements.exists():
            raise SystemExit(f"Torch requirements file not found: {torch_requirements}")
        install_cpu_torch(uv_path, python_env_path, torch_requirements)
        cpu_import_ok, cpu_import_detail = validate_torch_import(python_env_path)
        if not cpu_import_ok:
            raise SystemExit(f"CPU PyTorch import failed after installation: {cpu_import_detail}")
        print(f"[bootstrap] {cpu_import_detail}")
    elif selected_torch_mode == "cuda":
        resolved_index, resolved_build = resolve_torch_index(matrix, args.torch_build, selected_torch_index)
        effective_build = selected_torch_build or resolved_build
        if effective_build is not None:
            platform_key = normalize_runtime_platform()
            architecture = normalize_runtime_architecture()
            if not build_supported_on_current_platform(effective_build, platform_key, architecture):
                raise SystemExit(
                    f"Torch build {effective_build['key']} is not supported on {platform_key}/{architecture}."
                )
            min_driver = driver_requirement_for_platform(effective_build, platform_key)
            print(
                f"[bootstrap] Installing {effective_build['label']} "
                f"(build key {effective_build['key']}, index {resolved_index}, min driver {min_driver or 'unknown'})."
            )
        else:
            print(f"[bootstrap] Installing custom CUDA torch index: {resolved_index}")

        install_cuda_torch(uv_path, python_env_path, resolved_index)

        cuda_ok, cuda_detail = validate_torch_cuda_runtime(python_env_path)
        if cuda_ok:
            print(f"[bootstrap] {cuda_detail}")
        elif args.torch_mode == "auto":
            if not torch_requirements.exists():
                raise SystemExit(f"Torch requirements file not found: {torch_requirements}")
            print("[bootstrap] CUDA PyTorch validation failed after installation; falling back to the CPU build.")
            print(f"[bootstrap] Torch validation error: {cuda_detail}")
            install_cpu_torch(uv_path, python_env_path, torch_requirements)
            cpu_import_ok, cpu_import_detail = validate_torch_import(python_env_path)
            if not cpu_import_ok:
                raise SystemExit(f"CPU PyTorch import failed after fallback: {cpu_import_detail}")
            print(f"[bootstrap] {cpu_import_detail}")
        else:
            raise SystemExit(
                "CUDA PyTorch validation failed after installation. "
                f"Validation error: {cuda_detail}"
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
