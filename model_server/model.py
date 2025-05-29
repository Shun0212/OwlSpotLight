from sentence_transformers import SentenceTransformer
import numpy as np

model = SentenceTransformer("Shuu12121/CodeSearch-ModernBERT-Owl-2.0-Plus")

def encode_code(codes: list[str]) -> np.ndarray:
    return model.encode(codes, normalize_embeddings=True)
ß