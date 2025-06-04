from pathlib import Path
from .python_extractor import extract_python_functions
from .java_extractor import extract_java_functions


def extract_functions(file_path: str | Path) -> list[dict]:
    path = Path(file_path)
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            source_code = f.read()
    except Exception as e:
        print(f"Error reading {path}: {e}")
        return []

    source_bytes = source_code.encode("utf-8")
    ext = path.suffix.lower()
    if ext == ".py":
        return extract_python_functions(source_bytes)
    if ext == ".java":
        return extract_java_functions(source_bytes)
    return []

__all__ = ["extract_functions"]
