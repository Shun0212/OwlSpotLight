from sentence_transformers import SentenceTransformer
import numpy as np
import sys

def supports_flash_attention() -> bool:
    if sys.platform == "darwin":
        return False
    try:
        import flash_attn_2  # type: ignore
        return True
    except Exception:
        try:
            import flash_attn  # type: ignore
            return True
        except Exception:
            return False

_model_kwargs = {"attn_implementation": "flash_attention_2"} if supports_flash_attention() else {}
model = SentenceTransformer("Shuu12121/CodeSearch-ModernBERT-Owl-2.0-Plus", **_model_kwargs)

def encode_code(codes: list[str], batch_size: int = 32) -> np.ndarray:
    return model.encode(codes, batch_size=batch_size, normalize_embeddings=True)
