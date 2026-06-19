"""インデックス作成の進捗を共有するための軽量なステート。

サーバー（FastAPI）とモデル側（埋め込み生成）の両方から更新され、
拡張機能が /index_progress 経由でポーリングして UI に反映する。
"""
import threading
import time

_lock = threading.Lock()
_cancel_event = threading.Event()


class OperationCancelled(Exception):
    """Raised when the current indexing/embedding operation is cancelled."""


_state = {
    "active": False,
    "phase": "",
    "current": 0,
    "total": 0,
    "started_at": 0.0,
    "updated_at": 0.0,
    "cancel_requested": False,
}


def start(phase: str, total: int) -> None:
    with _lock:
        _state["active"] = True
        _state["phase"] = phase
        _state["current"] = 0
        _state["total"] = max(0, int(total))
        _state["started_at"] = time.time()
        _state["updated_at"] = _state["started_at"]
        _state["cancel_requested"] = _cancel_event.is_set()


def update(current: int, total: int = None, phase: str = None) -> None:
    with _lock:
        _state["active"] = True
        if not _state["started_at"]:
            _state["started_at"] = time.time()
        _state["current"] = max(0, int(current))
        if total is not None:
            _state["total"] = max(0, int(total))
        if phase is not None:
            _state["phase"] = phase
        _state["updated_at"] = time.time()
        _state["cancel_requested"] = _cancel_event.is_set()


def finish() -> None:
    with _lock:
        _state["active"] = False
        _state["current"] = _state["total"]
        _state["updated_at"] = time.time()
        _state["cancel_requested"] = _cancel_event.is_set()


def request_cancel() -> None:
    _cancel_event.set()
    with _lock:
        _state["cancel_requested"] = True
        _state["updated_at"] = time.time()
        if _state.get("active") and not str(_state.get("phase", "")).startswith("Cancelling"):
            _state["phase"] = f"Cancelling {_state.get('phase') or 'operation'}"


def clear_cancel() -> None:
    _cancel_event.clear()
    with _lock:
        _state["cancel_requested"] = False


def is_cancelled() -> bool:
    return _cancel_event.is_set()


def raise_if_cancelled() -> None:
    if _cancel_event.is_set():
        raise OperationCancelled("Operation cancelled")


def snapshot() -> dict:
    with _lock:
        snap = dict(_state)
    started = snap.get("started_at") or 0.0
    elapsed = max(0.0, snap["updated_at"] - started) if started else 0.0
    snap["elapsed"] = elapsed
    # 残り時間の推定（現在の処理速度から外挿）
    eta = None
    current = snap.get("current") or 0
    total = snap.get("total") or 0
    if snap.get("active") and elapsed > 0 and current > 0 and total > current:
        rate = current / elapsed  # items per second
        if rate > 0:
            eta = (total - current) / rate
    snap["eta"] = eta
    return snap
