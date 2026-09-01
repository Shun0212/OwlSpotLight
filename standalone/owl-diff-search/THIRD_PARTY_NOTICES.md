# Third-party notices

This standalone extension adapts the Git Diff search workflow from
[Shun0212/OwlSpotLight](https://github.com/Shun0212/OwlSpotLight),
reference commit 5397314df520aecffa8300489dea11bddf3b1ecf (v0.5.4).

backend/model.py is derived from OwlSpotLight's model_server/model.py.
The model initially loads on CPU before the original device fallback logic.
The upstream MIT copyright and permission notice are included in LICENSE.

The default embedding model is
[Shuu12121/NightOwl-CodeEmbedding](https://huggingface.co/Shuu12121/NightOwl-CodeEmbedding).
Model weights are downloaded separately during setup and are not bundled in the VSIX.
The model's own license and model card apply to its weights.

Python dependencies are installed into a dedicated virtual environment.
Their respective licenses apply; they are not redistributed in the VSIX.

This project is a separate integration. Its extension identifier is
owl-diff-local.owl-diff-search. It does not register the original OwlSpotLight identifier.
