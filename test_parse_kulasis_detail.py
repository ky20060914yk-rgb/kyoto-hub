import requests
from bs4 import BeautifulSoup
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

urls = [
    'https://www.k.kyoto-u.ac.jp/external/open_syllabus/la_syllabus?lectureNo=61323&display_lang=jp',
    'https://www.k.kyoto-u.ac.jp/external/open_syllabus/department_syllabus?lectureNo=26510&departmentNo=1&display_lang=jp',
]

for url in urls:
    print(f"\n==========================================")
    print(f"Testing URL: {url}")
    r = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'})
    r.encoding = 'windows-31j'
    soup = BeautifulSoup(r.text, 'html.parser')

    class_name = ""
    instructor = ""
    affiliation = ""
    datetime_str = ""

    tds = soup.find_all('td')
    for i, td in enumerate(tds):
        txt = td.get_text(strip=True)

        if '(科目名)' in txt and i + 1 < len(tds):
            class_name = tds[i+1].get_text(strip=True)

        if '(担当教員)' in txt:
            # Check subsequent TDs for instructor name
            for j in range(i + 1, min(i + 6, len(tds))):
                candidate = tds[j].get_text(strip=True)
                if candidate and candidate not in ['(担当教員)', '(職 位)', '(所 属)', '(E ﾒｰﾙ)', '(室 番号)']:
                    if not instructor:
                        instructor = candidate
                    elif not affiliation and candidate != instructor:
                        affiliation = candidate

        if '(曜時限)' in txt and i + 1 < len(tds):
            datetime_str = tds[i+1].get_text(strip=True)

    print(f"・科目名: '{class_name}'")
    print(f"・担当教員: '{instructor}'")
    print(f"・所属/学部: '{affiliation}'")
    print(f"・曜時限: '{datetime_str}'")
