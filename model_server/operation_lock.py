"""One model/index operation at a time, without blocking the API event loop."""
from functools import wraps
from threading import Lock
import time
import uuid

from fastapi import HTTPException
import progress


class OperationLock:
    def __init__(self):
        self._lock = Lock()
        self._state_lock = Lock()
        self._operation = None
        self._started_at = None
        self._operation_id = None
        self._cancelled_ids = {}

    def snapshot(self):
        with self._state_lock:
            return {
                "busy": self._operation is not None,
                "operation": self._operation,
                "operation_id": self._operation_id,
                "operation_started_at": self._started_at,
            }

    def cancel(self, operation_id=None):
        with self._state_lock:
            if operation_id:
                # Remember early cancellation while its HTTP search is in flight.
                now = time.monotonic()
                self._cancelled_ids = {key: expiry for key, expiry in self._cancelled_ids.items() if expiry > now}
                if len(self._cancelled_ids) >= 256:
                    self._cancelled_ids.pop(next(iter(self._cancelled_ids)))
                self._cancelled_ids[operation_id] = now + 1800
            matches = self._operation is not None and (not operation_id or operation_id == self._operation_id)
            if matches:
                progress.request_cancel()
            return {"cancel_requested": matches, "operation_id": operation_id,
                    "message": "Cancellation requested." if matches else "No matching active operation."}

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
                request = kwargs.get("req") or (args[0] if args else None)
                operation_id = getattr(request, "operation_id", None) or str(uuid.uuid4())
                with self._state_lock:
                    progress.clear_cancel()
                    self._operation_id = operation_id
                    if self._cancelled_ids.get(operation_id, 0) > time.monotonic():
                        progress.request_cancel()
                    self._operation = function.__name__
                    self._started_at = time.time()
                progress.raise_if_cancelled()
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
                    self._operation_id = None
                    self._operation = None
                    self._started_at = None
                self._lock.release()
        return run
