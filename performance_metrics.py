"""Bounded, payload-free local diagnostics; never record account data or queries."""

from collections import deque
from contextlib import contextmanager
import threading
import time

_SAMPLES = deque(maxlen=200)
_LOCK = threading.Lock()


@contextmanager
def measure_operation(operation):
    started = time.perf_counter()
    counts = {}
    try:
        yield counts
    finally:
        sample = {"operation": operation, "durationMs": round((time.perf_counter() - started) * 1000, 2), **counts}
        with _LOCK:
            _SAMPLES.append(sample)


def performance_snapshot():
    with _LOCK:
        return {"capacity": _SAMPLES.maxlen, "samples": [dict(sample) for sample in _SAMPLES]}
