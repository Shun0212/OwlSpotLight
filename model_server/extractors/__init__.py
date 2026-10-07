from pathlib import Path
from .python_extractor import extract_python_functions
from .java_extractor import extract_java_functions
from .typescript_extractor import extract_typescript_functions
from .generic_extractor import extract_generic_functions

# Python backend only: the server-free Node.js backend does not parse these.
GENERIC_LANGUAGE_BY_EXTENSION = {
    ".rs": "rust",
    ".go": "go",
    ".c": "c",
    ".h": "cpp",
    ".cc": "cpp",
    ".cpp": "cpp",
    ".cxx": "cpp",
    ".hh": "cpp",
    ".hpp": "cpp",
}


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
    if ext in {".ts", ".tsx"}:
        return extract_typescript_functions(source_bytes, "tsx" if ext == ".tsx" else "typescript")
    if ext in {".js", ".jsx"}:
        return extract_typescript_functions(source_bytes, "jsx" if ext == ".jsx" else "javascript")
    if ext in GENERIC_LANGUAGE_BY_EXTENSION:
        return extract_generic_functions(source_bytes, GENERIC_LANGUAGE_BY_EXTENSION[ext])
    return []

__all__ = ["extract_functions"]
