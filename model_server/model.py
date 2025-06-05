from sentence_transformers import SentenceTransformer
import numpy as np
import os

DEFAULT_MODEL = "Shuu12121/CodeSearch-ModernBERT-Owl-2.0-Plus"
model_name = os.environ.get("OWL_MODEL_NAME", DEFAULT_MODEL)
model = SentenceTransformer(model_name)

def encode_code(codes: list[str], batch_size: int = 32) -> np.ndarray:
    return model.encode(codes, batch_size=batch_size, normalize_embeddings=True)
