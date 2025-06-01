from sentence_transformers import SentenceTransformer
import numpy as np

model = SentenceTransformer("Shuu12121/CodeSearch-ModernBERT-Owl-2.0-Plus")

def encode_code(codes: list[str], batch_size: int = 32) -> np.ndarray:
    return model.encode(codes, batch_size=batch_size, normalize_embeddings=True)
