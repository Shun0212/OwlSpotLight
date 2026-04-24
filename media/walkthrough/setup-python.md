# Set up the Python environment

OwlSpotlight ships with a Python backend that runs the embedding model and the
tree-sitter powered code graph.

Run the command **OwlSpotlight: Setup Python Environment** from the Command
Palette (`Ctrl/Cmd+Shift+P`). This will:

1. Create a local `.venv` under `model_server/`.
2. Install PyTorch (CPU by default) and the embedding model dependencies.
3. Download the default HuggingFace model (`Shuu12121/Owl-ph2-len2048`).

You can change the Python version or the HuggingFace model later from
**OwlSpotlight settings**.
