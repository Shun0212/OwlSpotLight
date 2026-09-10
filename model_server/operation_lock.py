"""One model/index operation at a time, without blocking the API event loop."""
from functools import wraps
from threading import Lock
import time

from fastapi import HTTPException
import progress


class OperationLock:
    def __init__(self):
        self._lock = Lock()
        self._state_lock = Lock()
        self._operation = None
        self._started_at = None

    def snapshot(self):
        with self._state_lock:
            return {
                "busy": self._operation is not None,
                "operation": self._operation,
                "operation_started_at": self._started_at,
            }

    def exclusive(self, function):
        # A synchronous endpoint runs in FastAPI's thread pool. The lock remains
        # held until the actual worker finishes, including after disconnection.
        @wraps(function)
        def run(*args, **kwargs):
            if not self._lock.acquire(blocking=False):
                raise HTTPException(
                    status_code=409,
                    detail={"message": "OwlSpotlight is busy. Wait for the current operation or cancel it.",
                            **self.snapshot()},
                    headers={"Retry-After": "2"},
                )
            try:
                progress.clear_cancel()
                with self._state_lock:
                    self._operation = function.__name__
                    self._started_at = time.time()
                result = function(*args, **kwargs)
                if isinstance(result, dict) and result.get("cancelled"):
                    return result
                # A stop during the last retrieval step must not publish success.
                progress.raise_if_cancelled()
                return result
            except progress.OperationCancelled:
                return {"cancelled": True, "message": "Operation stopped."}
            finally:
                progress.finish()
                with self._state_lock:
                    self._operation = None
                    self._started_at = None
                self._lock.release()
        return run
