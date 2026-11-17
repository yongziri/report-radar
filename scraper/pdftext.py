"""리포트 레이더 — 리포트 PDF 1쪽 텍스트 추출 (pypdf).

증권사 사이트가 목록에 목표주가를 주지 않을 때 PDF 첫 쪽에서 읽는다. 받는 크기에 상한을 두고,
스캔본(이미지)·깨진 파일·네트워크 오류는 모두 None으로 돌려준다(예외를 밖으로 내지 않는다).
의견·목표가를 뽑는 정규식은 parsers.extract_pdf_opinion에 있다(네트워크 없이 테스트한다).
"""

import io
import logging

MAX_BYTES = 8 * 1024 * 1024
TIMEOUT = 20
# 스캔본은 텍스트가 거의 안 나온다. 이보다 짧으면 못 읽은 것으로 본다.
MIN_TEXT = 30

# pypdf가 깨진 xref 등에 경고를 많이 찍는다. 수집 로그를 덮지 않게 줄인다.
logging.getLogger("pypdf").setLevel(logging.ERROR)


def download_pdf(session, url, timeout=TIMEOUT, max_bytes=MAX_BYTES):
    """PDF 바이트. 크기 초과·HTTP 오류·PDF 아님이면 None."""
    try:
        with session.get(url, stream=True, timeout=timeout) as resp:
            resp.raise_for_status()
            length = resp.headers.get("Content-Length")
            if length and length.isdigit() and int(length) > max_bytes:
                return None
            buf = bytearray()
            for chunk in resp.iter_content(65536):
                buf.extend(chunk)
                if len(buf) > max_bytes:
                    return None
    except Exception:
        return None
    data = bytes(buf)
    if b"%PDF" not in data[:1024]:
        return None
    return data


def first_page_text(data):
    """PDF 바이트 -> 1쪽 텍스트. pypdf가 없거나 못 읽으면 None."""
    if not data:
        return None
    try:
        from pypdf import PdfReader
    except ImportError:
        return None
    try:
        reader = PdfReader(io.BytesIO(data))
        if not reader.pages:
            return None
        text = (reader.pages[0].extract_text() or "").strip()
    except Exception:
        return None
    return text if len(text) >= MIN_TEXT else None


def fetch_first_page_text(session, url, timeout=TIMEOUT, max_bytes=MAX_BYTES):
    """URL의 PDF를 받아 1쪽 텍스트를 돌려준다. 실패하면 None."""
    return first_page_text(download_pdf(session, url, timeout=timeout, max_bytes=max_bytes))
