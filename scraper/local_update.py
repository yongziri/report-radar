r"""이 PC(국내 IP)에서만 열리는 소스를 갱신한다 — 지금은 BNK투자증권.

GitHub Actions 러너(해외 IP)에서는 BNK가 ConnectTimeout 이라 CI로는 갱신되지 않는다.
Windows 작업 스케줄러가 평일 저녁에 이 스크립트를 부른다. 사람이 직접 돌려도 된다.

    python scraper/local_update.py            # 평소
    python scraper/local_update.py --dry-run  # 저장·커밋·push 없이 흐름만 확인
    python scraper/local_update.py --force    # BNK 접속 확인을 건너뛰고 수집

안전 규칙 (하나라도 어긋나면 아무것도 하지 않고 끝낸다):
- 저장소가 main 브랜치이고, 추적 중인 파일에 고치던 것이 없어야 한다.
- 올리지 않은 로컬 커밋이 없어야 한다 (pull 뒤 HEAD == origin/main).
- BNK 목록 주소가 열려야 한다 (학교망 낮 시간에는 SSL 오류로 막힌다).
push 가 거부되면(그사이 CI가 데이터를 올림) 방금 만든 데이터 커밋만 버리고 다음 실행에 맡긴다.

기록: %LOCALAPPDATA%\report-radar\local_update.log (최근 400줄만 남긴다)
"""

import argparse
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KST = timezone(timedelta(hours=9))
LOG_DIR = os.path.join(os.environ.get("LOCALAPPDATA") or ROOT, "report-radar")
LOG_PATH = os.path.join(LOG_DIR, "local_update.log")
LOCK_PATH = os.path.join(LOG_DIR, "local_update.lock")
LOG_KEEP_LINES = 400
LOCK_STALE_SECONDS = 40 * 60
COLLECT_TIMEOUT = 20 * 60
# 창 없이 자식 프로세스를 띄운다 (작업 스케줄러에서 콘솔 창이 깜빡이지 않게).
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def log(msg):
    line = "%s  %s" % (datetime.now(KST).strftime("%Y-%m-%d %H:%M:%S"), msg)
    try:
        os.makedirs(LOG_DIR, exist_ok=True)
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass
    if sys.stdout is not None:      # pythonw.exe 로 돌면 stdout 이 없다
        try:
            print(line)
        except Exception:
            pass


def trim_log():
    try:
        with open(LOG_PATH, encoding="utf-8") as f:
            lines = f.readlines()
        if len(lines) > LOG_KEEP_LINES:
            with open(LOG_PATH, "w", encoding="utf-8") as f:
                f.writelines(lines[-LOG_KEEP_LINES:])
    except OSError:
        pass


def run(cmd, timeout=120):
    """(종료 코드, 출력). 실행 자체가 안 되거나 시간이 넘으면 (None, 사유)."""
    env = dict(os.environ, PYTHONIOENCODING="utf-8", GIT_TERMINAL_PROMPT="0")
    try:
        p = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
                           errors="replace", timeout=timeout, env=env, creationflags=NO_WINDOW,
                           stdin=subprocess.DEVNULL)
    except subprocess.TimeoutExpired:
        return None, "시간 초과 (%d초)" % timeout
    except OSError as exc:
        return None, str(exc)
    return p.returncode, ((p.stdout or "") + (p.stderr or "")).strip()


def git(*args, timeout=120):
    return run(["git"] + list(args), timeout=timeout)


def python_exe():
    """pythonw.exe 로 불렸어도 자식은 python.exe 로 돌린다."""
    exe = sys.executable or "python"
    cand = os.path.join(os.path.dirname(exe), "python.exe")
    return cand if os.path.exists(cand) else exe


def bnk_reachable():
    sys.path.insert(0, os.path.join(ROOT, "scraper"))
    try:
        import requests
        from parsers import BNK_LIST_URL
    except Exception as exc:
        return False, "가져오기 실패: %s" % exc
    try:
        r = requests.get(BNK_LIST_URL, timeout=(5, 10), headers={"User-Agent": "Mozilla/5.0"})
    except Exception as exc:
        return False, type(exc).__name__
    return (r.status_code == 200), "HTTP %d" % r.status_code


def take_lock():
    os.makedirs(LOG_DIR, exist_ok=True)
    try:
        if time.time() - os.path.getmtime(LOCK_PATH) < LOCK_STALE_SECONDS:
            return False
    except OSError:
        pass
    with open(LOCK_PATH, "w", encoding="utf-8") as f:
        f.write(str(os.getpid()))
    return True


def release_lock():
    try:
        os.remove(LOCK_PATH)
    except OSError:
        pass


def main(argv=None):
    ap = argparse.ArgumentParser(description="국내 IP 전용 소스(BNK) 로컬 갱신")
    ap.add_argument("--dry-run", action="store_true", help="저장·커밋·push 없이 흐름만 확인")
    ap.add_argument("--force", action="store_true", help="BNK 접속 확인을 건너뛴다")
    args = ap.parse_args(argv)

    if not take_lock():
        log("다른 실행이 진행 중 — 건너뜀")
        return 0
    try:
        return work(args)
    finally:
        release_lock()
        trim_log()


def work(args):
    code, out = git("rev-parse", "--abbrev-ref", "HEAD")
    if code != 0 or out != "main":
        log("main 브랜치가 아님(%s) — 건너뜀" % (out or code))
        return 0
    code, out = git("status", "--porcelain", "--untracked-files=no")
    if code != 0 or out:
        log("고치던 파일이 있음 — 건너뜀")
        return 0

    if not args.force:
        ok, why = bnk_reachable()
        if not ok:
            log("BNK 접속 불가(%s) — 건너뜀" % why)
            return 0

    code, out = git("pull", "--ff-only", "origin", "main", timeout=180)
    if code != 0:
        log("pull 실패 — 건너뜀: %s" % (out or "")[-200:])
        return 0
    code, out = git("rev-list", "--count", "origin/main..HEAD")
    if code != 0 or out != "0":
        log("올리지 않은 로컬 커밋이 있음 — 건너뜀")
        return 0

    cmd = [python_exe(), os.path.join("scraper", "collect.py")]
    if args.dry_run:
        cmd.append("--dry-run")
    t0 = time.time()
    code, out = run(cmd, timeout=COLLECT_TIMEOUT)
    took = time.time() - t0
    tail = [ln for ln in (out or "").splitlines() if "BNK" in ln or ln.startswith("총 ")][-3:]
    for ln in tail:
        log("  " + ln.strip()[:220])
    if code != 0:
        log("수집 실패(종료 %s, %.0f초): %s" % (code, took, (out or "")[-200:]))
        git("checkout", "--", "data")
        return 1
    if args.dry_run:
        log("dry-run 끝 (%.0f초) — 저장·커밋 없음" % took)
        return 0

    code, out = git("status", "--porcelain", "--", "data")
    if code != 0 or not out:
        log("바뀐 데이터 없음 (%.0f초)" % took)
        return 0
    git("add", "-A", "data")
    stamp = datetime.now(KST).strftime("%Y-%m-%d %H:%M")
    code, out = git("commit", "-m", "data: %s KST (로컬 수집)" % stamp)
    if code != 0:
        log("커밋 실패: %s" % (out or "")[-200:])
        git("reset", "-q")
        git("checkout", "--", "data")
        return 1
    code, out = git("push", "origin", "HEAD:main", timeout=180)
    if code != 0:
        # 수집하는 사이 CI가 데이터를 올렸다. 방금 만든 커밋만 버리고 다음 실행에 맡긴다.
        git("fetch", "origin", timeout=180)
        git("reset", "--hard", "origin/main")
        log("push 거부 — 이번 수집분은 버림 (다음 실행에서 다시)")
        return 0
    log("올림: data %s KST (%.0f초)" % (stamp, took))
    return 0


if __name__ == "__main__":
    sys.exit(main())
