"""Deprecated shim: prefer ``owl_core.extractors`` going forward.

Kept so that any external tooling importing the old module keeps working.
"""
from owl_core.extractors import extract_functions, extract_symbols

__all__ = ["extract_functions", "extract_symbols"]
