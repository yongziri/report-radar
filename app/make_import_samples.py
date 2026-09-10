"""잔고 가져오기 파서 검증용 합성 샘플 3종 생성.

실제 HTS 내보내기에서 흔한 형태를 모사한다(계좌정보 머리행, A접두 코드, 쉼표 숫자,
코드 열 없는 그리드 복사, 합계행·빈행·우선주 혼입).
출력: tools/samples/holdings_*.{csv,txt}
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "samples")
os.makedirs(OUT, exist_ok=True)

# ① EUC-KR 쉼표 CSV — 상단 계좌정보 2행 + 헤더, A접두어 코드, 쉼표 숫자
s1 = """계좌번호,123-45-678901,예수금,"1,250,000"
조회일시,2026-08-03 09:15:22,,
종목번호,종목명,보유수량,매입평균가,평가금액,평가손익
A005930,삼성전자,150,"71,200","36,375,000","25,695,000"
A000660,SK하이닉스,20,"245,000","31,980,000","27,080,000"
A035420,NAVER,45,"198,500","9,900,000","-32,500"
A051910,LG화학,12,"412,000","4,320,000","-624,000"
"""

# ② UTF-8 탭 붙여넣기 — 코드 열 없음(종목명 역매핑), 그리드 복사 모사
s2 = """종목명\t잔고수량\t평단가\t평가금액
카카오\t80\t52,300\t3,912,000
현대차\t30\t201,500\t6,660,000
셀트리온\t25\t168,000\t4,050,000
삼성전자우\t60\t58,900\t3,363,000
"""

# ③ 지저분한 케이스 — 빈 행, 합계/총계 행(제외 대상), 우선주, 공백 섞인 이름
s3 = """종목코드,종목명,수량,매입단가

005930, 삼성전자 ,10,"70,000"
005935,삼성전자우,5,"58,000"

373220,LG에너지솔루션,3,"395,000"
합계,,18,
총계,,,"1,203,000"
"""

with open(os.path.join(OUT, "holdings_euckr.csv"), "wb") as f:
    f.write(s1.replace("\n", "\r\n").encode("euc-kr"))
with open(os.path.join(OUT, "holdings_tab.txt"), "w", encoding="utf-8", newline="\n") as f:
    f.write(s2)
with open(os.path.join(OUT, "holdings_messy.csv"), "w", encoding="utf-8", newline="\n") as f:
    f.write(s3)

for n in ("holdings_euckr.csv", "holdings_tab.txt", "holdings_messy.csv"):
    p = os.path.join(OUT, n)
    print("%-24s %5d bytes" % (n, os.path.getsize(p)))
print("done")
