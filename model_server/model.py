from sentence_transformers import SentenceTransformer
import numpy as np
import os
import torch
import gc
import time
import warnings
import logging
import builtins as _builtins
import progress

# 詳細なサーバーログは既定でオフ。OWLSPOTLIGHT_DEBUG=1 で再度有効化できる。
OWL_DEBUG = os.environ.get("OWLSPOTLIGHT_DEBUG", "").strip().lower() in ("1", "true", "yes", "on")

def print(*args, **kwargs):  # noqa: A001 - 冗長ログを抑制するためモジュール内で組み込み print を上書き
    if OWL_DEBUG:
        _builtins.print(*args, **kwargs)

# MPSデバイス使用時のtorch.compile警告を抑制
warnings.filterwarnings("ignore", message=".*torch.compile.*mps.*", category=UserWarning)
# Sentence Transformers のバージョン不一致など冗長な警告ログを抑制
warnings.filterwarnings("ignore", message=".*Sentence Transformers version.*")
if not OWL_DEBUG:
    logging.getLogger("sentence_transformers").setLevel(logging.ERROR)

DEFAULT_MODEL = "Shuu12121/NightOwl-CodeEmbedding"
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


def get_device_fallback_order():
    """優先デバイスからCPUまでのフォールバック順を返す"""
    primary_device = get_device()
    devices = [primary_device]
    if primary_device != "cpu":
        devices.append("cpu")
    return devices

def cleanup_memory():
    """メモリクリーンアップを実行"""
    if torch.backends.mps.is_available():
        torch.mps.empty_cache()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    gc.collect()

def load_model_with_device_fallback():
    """モデルを適切なデバイスで読み込み、必要に応じてフォールバック"""
    global model, model_device
    
    if model is not None:
        return model
    
    print(f"[model] Loading model: {model_name}")
    
    model = SentenceTransformer(model_name)

    # MPSデバイスの場合、torch.compileを無効化してwarningを防ぐ
    if hasattr(model, '_modules'):
        for module in model._modules.values():
            if hasattr(module, '_is_compiled'):
                module._is_compiled = False

    last_error = None
    for device in get_device_fallback_order():
        try:
            print(f"[model] Attempting to use device: {device}")
            model.to(device)
            model_device = device
            print(f"[model] Model loaded successfully on {device}")
            emb_dim = model.get_sentence_embedding_dimension()
            print(f"[model] Embedding dimension: {emb_dim}")
            return model
        except Exception as e:
            last_error = e
            print(f"[model] Failed to load model on {device}: {e}")
            cleanup_memory()
            if device != "cpu":
                print("[model] Falling back to CPU...")

    if last_error is not None:
        raise last_error

    raise RuntimeError("Failed to load the model on any device")

def get_model():
    """モデルインスタンスを取得（遅延読み込み）"""
    if model is None:
        load_model_with_device_fallback()
    return model

def _encode_inputs(current_model, inputs: list[str], batch_size: int, input_type: str) -> np.ndarray:
    if input_type == "query" and hasattr(current_model, "encode_query"):
        encode_fn = current_model.encode_query
    elif input_type == "document" and hasattr(current_model, "encode_document"):
        encode_fn = current_model.encode_document
    else:
        encode_fn = current_model.encode

    return encode_fn(
        inputs,
        batch_size=batch_size,
        normalize_embeddings=True,
        show_progress_bar=False,
        convert_to_numpy=True
    )


def encode_code(
    codes: list[str],
    batch_size: int = 2,
    max_retries: int = 3,
    show_progress: bool = True,
    input_type: str = "document",
) -> np.ndarray:
    """コードをエンコードし、メモリエラー時は自動的にバッチサイズを調整。

    バッチごとに進捗を progress モジュールへ報告するため、内部のtqdmバーは無効化し、
    代わりに拡張機能側で実際の割合を表示できるようにする。"""
    global model_device

    current_model = get_model()
    total = len(codes)
    batch_size = max(1, int(batch_size or 2))
    input_type = input_type if input_type in {"document", "query", "generic"} else "document"

    # 進捗を報告するか（環境変数で抑制可能）
    report = show_progress and progress_env not in ("0", "false") and total > 0

    for attempt in range(max_retries):
        try:
            progress.raise_if_cancelled()
            if total == 0:
                emb_dim = current_model.get_sentence_embedding_dimension()
                return np.zeros((0, emb_dim), dtype=np.float32)
            if report:
                progress.start("Embedding", total)
            chunks = []
            t0 = time.time()
            for start_idx in range(0, total, batch_size):
                progress.raise_if_cancelled()
                batch = codes[start_idx:start_idx + batch_size]
                emb = _encode_inputs(current_model, batch, batch_size, input_type)
                progress.raise_if_cancelled()
                chunks.append(emb)
                done = min(start_idx + batch_size, total)
                if report:
                    # ライブな進捗はサイドバー UI（/index_progress）に表示。
                    # 出力パネルは追記専用でバーを上書きできないため、進捗はここでは出さない。
                    progress.update(done, total)
            if report:
                progress.finish()
                # 出力パネルには要約を1行だけ。
                _builtins.print(f"[embed] {total} items in {time.time() - t0:.1f}s", flush=True)
            if chunks:
                return np.vstack(chunks)
            emb_dim = current_model.get_sentence_embedding_dimension()
            return np.zeros((0, emb_dim), dtype=np.float32)

        except (RuntimeError, torch.cuda.OutOfMemoryError) as e:
            error_msg = str(e).lower()
            if "memory" in error_msg or "out of memory" in error_msg:
                print(f"[model] Memory error on attempt {attempt + 1}: {e}")
                cleanup_memory()
                
                if attempt < max_retries - 1:
                    # バッチサイズを半分に減らして再試行
                    batch_size = max(1, batch_size // 2)
                    print(f"[model] Reducing batch size to {batch_size} and retrying...")
                    
                    # 最後の試行でGPU系デバイスが失敗した場合、CPUにフォールバック
                    if attempt == max_retries - 2 and model_device in ("mps", "cuda"):
                        print(f"[model] Falling back to CPU due to persistent {model_device.upper()} memory issues...")
                        current_model.to("cpu")
                        model_device = "cpu"
                        cleanup_memory()
                else:
                    print("[model] All memory optimization attempts failed")
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
