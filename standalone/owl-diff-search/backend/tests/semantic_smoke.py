"""Run explicitly after installing model dependencies. Downloads NightOwl on first run."""
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ranking import DenseRanker

documents = [
    "--- a/client.py\n+++ b/client.py\n@@ -1,2 +1,5 @@\n-def fetch(url):\n-    return requests.get(url)\n+def fetch(url):\n+    for attempt in range(3):\n+        try: return requests.get(url, timeout=10)\n+        except requests.Timeout: time.sleep(2 ** attempt)\n+    raise TimeoutError(url)",
    "--- a/theme.css\n+++ b/theme.css\n@@ -1 +1 @@\n-body { color: black; }\n+body { color: navy; }",
    "--- a/math.py\n+++ b/math.py\n@@ -1,2 +1,2 @@\n def square(x):\n-    return x\n+    return x * x",
]
ranker = DenseRanker()
scores = ranker.score(documents, "retry failed HTTP requests with exponential backoff", print)
assert max(scores, key=scores.get) == 0, scores
assert all(-1.01 <= value <= 1.01 for value in scores.values()), scores
again = ranker.score(documents, "retry failed HTTP requests with exponential backoff", print)
assert all(abs(scores[i] - again[i]) < 1e-4 for i in scores)
print("NightOwl semantic search and cached embeddings: PASS", scores)
