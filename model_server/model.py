from sentence_transformers import SentenceTransformer
import numpy as np
import os
import torch
import gc
import warnings

# MPSデバイス使用時のtorch.compile警告を抑制
warnings.filterwarnings("ignore", message=".*torch.compile.*mps.*", category=UserWarning)

DEFAULT_MODEL = "Shuu12121/CodeSearch-ModernBERT-Owl-3.0-Plus"
model_name = os.environ.get("OWL_MODEL_NAME", DEFAULT_MODEL)
# 環境変数で進捗表示を制御 ("0"/"false" で非表示)
progress_env = os.environ.get("OWL_PROGRESS", "1").lower()

# グローバル変数でモデルとデバイスを管理
model = None
model_device = None

def get_device():
    """利用可能な最適なデバイスを取得"""
    # Apple Silicon (M1/M2/M3) などで mps が使える場合は mps を優先
    if torch.backends.mps.is_available() and torch.backends.mps.is_built():
        return "mps"
    elif torch.cuda.is_available():
        return "cuda"
    else:
        return "cpu"

def cleanup_memory():
    """メモリクリーンアップを実行"""
    if torch.backends.mps.is_available():
        torch.mps.empty_cache()
    elif torch.cuda.is_available():
        torch.cuda.empty_cache()
    gc.collect()

def load_model_with_device_fallback():
    """モデルを適切なデバイスで読み込み、必要に応じてフォールバック"""
    global model, model_device
    
    if model is not None:
        return model
    
    print(f"🦉 Loading model: {model_name}")
    
    try:
        # まずはモデルを読み込み
        model = SentenceTransformer(model_name)
        
        # デバイスを決定して移動
        device = get_device()
        print(f"🔧 Attempting to use device: {device}")
        
        # MPSデバイスの場合、torch.compileを無効化してwarningを防ぐ
        if device == "mps":
            # SentenceTransformerの内部でtorch.compileが使用されないよう設定
            if hasattr(model, '_modules'):
                for module in model._modules.values():
                    if hasattr(module, '_is_compiled'):
                        module._is_compiled = False
        
        model.to(device)
        model_device = device
        print(f"✅ Model loaded successfully on {device}")
        emb_dim = model.get_sentence_embedding_dimension()
        print(f"ℹ️ Embedding dimension: {emb_dim}")
        
    except Exception as e:
        print(f"⚠️ Failed to load model on {device}: {e}")
        
        # MPSで失敗した場合はCPUにフォールバック
        if device == "mps":
            print("🔄 Falling back to CPU...")
            try:
                if model is not None:
                    model.to("cpu")
                else:
                    model = SentenceTransformer(model_name)
                    model.to("cpu")
                model_device = "cpu"
                cleanup_memory()
                print("✅ Model loaded successfully on CPU")
            except Exception as cpu_e:
                print(f"❌ Failed to load model on CPU: {cpu_e}")
                raise cpu_e
        else:
            raise e
    
    return model

def get_model():
    """モデルインスタンスを取得（遅延読み込み）"""
    if model is None:
        load_model_with_device_fallback()
    return model

def encode_code(codes: list[str], batch_size: int = 8, max_retries: int = 3, show_progress: bool = True) -> np.ndarray:
    """コードをエンコードし、メモリエラー時は自動的にバッチサイズを調整"""
    from tqdm import tqdm
    import sys

    current_model = get_model()

    # 環境変数や件数に応じて進捗表示を制御
    progress_enabled = (
        show_progress
        and progress_env not in ("0", "false")
        and len(codes) >= 10
    )

    for attempt in range(max_retries):
        try:
            return current_model.encode(
                codes,
                batch_size=batch_size,
                normalize_embeddings=True,
                show_progress_bar=progress_enabled,
                convert_to_numpy=True
            )
        
        except (RuntimeError, torch.cuda.OutOfMemoryError) as e:
            error_msg = str(e).lower()
            if "memory" in error_msg or "out of memory" in error_msg:
                print(f"⚠️ Memory error on attempt {attempt + 1}: {e}")
                cleanup_memory()
                
                if attempt < max_retries - 1:
                    # バッチサイズを半分に減らして再試行
                    batch_size = max(1, batch_size // 2)
                    print(f"🔄 Reducing batch size to {batch_size} and retrying...")
                    
                    # 最後の試行でMPSが失敗した場合、CPUにフォールバック
                    if attempt == max_retries - 2 and model_device == "mps":
                        print("🔄 Falling back to CPU due to persistent MPS memory issues...")
                        current_model.to("cpu")
                        model_device = "cpu"
                        cleanup_memory()
                else:
                    print("❌ All memory optimization attempts failed")
                    raise e
            else:
                raise e
    
    raise RuntimeError("Failed to encode after all retries")

def get_model_embedding_dim() -> int:
    """モデルの埋め込み次元数を取得"""
    current_model = get_model()
    return current_model.get_sentence_embedding_dimension()

def get_current_device() -> str:
    """現在使用中のデバイスを取得"""
    return model_device if model_device else "not_loaded"
