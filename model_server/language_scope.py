"""Shared source-language filtering for mixed-language repositories."""
from pathlib import Path

SUPPORTED_FILE_EXTENSIONS = (".py", ".java", ".ts", ".tsx", ".js", ".jsx")


def matches_language(filename: str, file_ext: str = "auto") -> bool:
    extension = Path(filename).suffix.lower()
    return extension in SUPPORTED_FILE_EXTENSIONS and (file_ext == "auto" or extension == file_ext)
