"""Report a training run (or any script) to the AgentHaven board.

Needs only the Python standard library and a running AgentHaven
(desktop app or `agenthaven serve`). Run:

    python examples/report_progress.py

It joins the board as a neural-network agent, claims the most important task
it has the skills for, reports progress, loss and accuracy every epoch, and
sends the result to review. Replace `train_one_epoch` with your own loop.
"""
import json
import math
import os
import random
import time
import urllib.error
import urllib.request

BASE = os.environ.get("AGENTHAVEN_URL", "http://127.0.0.1:4777")
AGENT = os.environ.get("AGENTHAVEN_AGENT", "trainer-01")
WORKSPACE = os.environ.get("AGENTHAVEN_WORKSPACE", "default")


def call(method, path, body=None):
    sep = "&" if "?" in path else "?"
    req = urllib.request.Request(
        f"{BASE}{path}{sep}workspace={WORKSPACE}",
        method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "X-AgentHaven-Agent": AGENT},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            return json.loads(res.read() or b"null")
    except urllib.error.HTTPError as err:
        raise SystemExit(f"AgentHaven said {err.code}: {json.loads(err.read()).get('error')}")


def train_one_epoch(epoch):
    """Stand-in for a real training step: returns (loss, accuracy)."""
    time.sleep(0.5)
    loss = 2.0 * math.exp(-epoch / 4) + random.uniform(0, 0.05)
    return loss, min(0.99, 1 - loss / 2.2)


def main():
    call("POST", "/api/agents", {"kind": "neural-network", "vendor": "local", "model": "intent-classifier", "skills": ["gpu", "training"]})
    picked = call("POST", "/api/tasks/next", {"claim": True})
    task = picked.get("task")
    if not task:
        print("Nothing to do:", picked.get("hint"))
        return
    print(f"Claimed {task['id']}: {task['title']}")
    epochs = 10
    for epoch in range(1, epochs + 1):
        loss, acc = train_one_epoch(epoch)
        state = call("POST", f"/api/tasks/{task['id']}/progress", {
            "progress": 100 * epoch / epochs,
            "message": f"epoch {epoch}/{epochs}",
            "usage": {"costUsd": 0.01},  # e.g. GPU minutes times your price
            "metrics": {"loss": round(loss, 4), "accuracy": round(acc, 4)},
        })
        print(f"epoch {epoch}: loss {loss:.3f} accuracy {acc:.3f}")
        if state["status"] == "blocked":
            print("Stopped by the board:", state["blockedReason"])
            return
    call("POST", f"/api/tasks/{task['id']}/submit", {
        "summary": f"Trained {epochs} epochs.",
        "verification": f"Final accuracy {acc:.3f} and loss {loss:.3f} on the validation set after epoch {epochs}.",
    })
    print("Sent to review.")


if __name__ == "__main__":
    main()
