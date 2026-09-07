import requests
from bs4 import BeautifulSoup
import sys

sys.stdout.reconfigure(encoding='utf-8')

depts = {
    '80': '全学共通科目',
    '1': '文学部',
    '4': '教育学部',
    '6': '法学部',
    '8': '経済学部',
    '10': '理学部',
    '12': '医学部',
    '14': '薬学部',
    '16': '工学部',
    '18': '農学部',
    '61': '総合人間学部',
}

for code, name in list(depts.items())[:3]:
    url = f'https://www.k.kyoto-u.ac.jp/external/open_syllabus/search?condition.departmentNo={code}&display_lang=jp'
    print(f"\n--- Searching {name} ({code}) ---")
    res = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'})
    res.encoding = 'windows-31j'
    soup = BeautifulSoup(res.text, 'html.parser')

    links = [a for a in soup.find_all('a', href=True) if 'syllabus' in a['href']]
    print(f"Found {len(links)} syllabus links for {name}")
    for a in links[:5]:
        print("Link text:", a.get_text(strip=True), "| href:", a['href'])
