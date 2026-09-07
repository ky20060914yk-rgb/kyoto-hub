import requests
from bs4 import BeautifulSoup
import json
import re
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.stdout.reconfigure(encoding='utf-8')

BASE_URL = 'https://www.k.kyoto-u.ac.jp/external/open_syllabus/'
ALL_URL = BASE_URL + 'all?display_lang=jp'
OUTPUT_JSON = r'C:\Users\PC_User\kyoto-u-sns\syllabus_data.json'
OUTPUT_DART = r'C:\Users\PC_User\.gemini\antigravity\scratch\kyoto_exam_hub\lib\services\kulasis_dataset.dart'

print("1. KULASIS シラバス一覧ページから全授業リンクを取得中...")
res = requests.get(ALL_URL, headers={'User-Agent': 'Mozilla/5.0'})
res.encoding = 'windows-31j'
soup = BeautifulSoup(res.text, 'html.parser')

syllabus_links = []
for a in soup.find_all('a', href=True):
    href = a['href']
    if 'la_syllabus?lectureNo=' in href:
        link = BASE_URL + href
        if 'display_lang' not in link:
            link += '&display_lang=jp'
        syllabus_links.append(link)

syllabus_links = list(dict.fromkeys(syllabus_links))
print(f"全 {len(syllabus_links)} 件の授業シラバスリンクを検出しました。")

results = []

def fetch_course_detail(link):
    try:
        r = requests.get(link, headers={'User-Agent': 'Mozilla/5.0'}, timeout=10)
        r.encoding = 'windows-31j'
        detail_soup = BeautifulSoup(r.text, 'html.parser')

        class_name = ""
        instructor = ""
        day = ""
        period = ""
        faculty = ""

        # 授業名
        th_sub = detail_soup.find(lambda t: t.name in ['span', 'td'] and '(科目名)' in t.get_text())
        if th_sub:
            td = th_sub.find_parent('td').find_next_sibling('td')
            if td:
                class_name = td.get_text(separator=' ', strip=True)

        # 担当教員
        th_inst = detail_soup.find(lambda t: t.name in ['span', 'td'] and '(担当教員)' in t.get_text())
        if th_inst:
            tr_h = th_inst.find_parent('tr')
            if tr_h:
                tr_v = tr_h.find_next_sibling('tr')
                if tr_v:
                    td_inst = tr_v.find('td')
                    if td_inst:
                        instructor = td_inst.get_text(separator=' ', strip=True)

        # 曜時限
        th_dt = detail_soup.find(lambda t: t.name in ['span', 'td'] and '(曜時限)' in t.get_text())
        if th_dt:
            td_dt = th_dt.find_parent('td').find_next_sibling('td')
            if td_dt:
                dt_str = td_dt.get_text(separator=' ', strip=True)
                if len(dt_str) >= 2 and dt_str[0] in '月火水木金土日':
                    day = dt_str[0]
                    period = dt_str[1:]
                else:
                    day = dt_str

        # 対象学部/開講学部
        th_fac = detail_soup.find(lambda t: t.name in ['span', 'td'] and ('(対象学部)' in t.get_text() or '(開講学部)' in t.get_text()))
        if th_fac:
            td_fac = th_fac.find_parent('td').find_next_sibling('td')
            if td_fac:
                faculty = td_fac.get_text(separator=' ', strip=True)

        if class_name:
            return {
                "授業名": class_name,
                "担当教員": instructor,
                "曜日": day,
                "時限": period,
                "学部": faculty,
                "url": link
            }
    except Exception as e:
        pass
    return None

print("2. マルチスレッド高速スクレイピングを開始します...")
# Take first 1000 or full set safely
sample_targets = syllabus_links[:1500]

with ThreadPoolExecutor(max_workers=20) as executor:
    futures = [executor.submit(fetch_course_detail, link) for link in sample_targets]
    count = 0
    for future in as_completed(futures):
        res_item = future.result()
        if res_item:
            results.append(res_item)
            count += 1
            if count % 100 == 0:
                print(f"進捗: {count}/{len(sample_targets)} 件取得完了...")

print(f"合計 {len(results)} 件の最新京大授業シラバスデータを正常取得！")

with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
    json.dump(results, f, ensure_ascii=False, indent=4)

print(f"JSONデータを {OUTPUT_JSON} に保存しました。")
