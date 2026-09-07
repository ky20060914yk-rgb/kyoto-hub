import requests
from bs4 import BeautifulSoup
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.stdout.reconfigure(encoding='utf-8')

BASE_URL = 'https://www.k.kyoto-u.ac.jp/external/open_syllabus/'
OUTPUT_JSON = r'C:\Users\PC_User\kyoto-u-sns\syllabus_data.json'
OUTPUT_DART = r'C:\Users\PC_User\.gemini\antigravity\scratch\kyoto_exam_hub\lib\services\kulasis_dataset.dart'

DAY_MAP = { '月': 'Mon', '火': 'Tue', '水': 'Wed', '木': 'Thu', '金': 'Fri', '土': 'Sat' }

DEPARTMENTS = {
    '80': '全学共通',
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

print("1. KULASIS全学・全学部シラバス一覧からアクティブな授業URLを取得中...")

# Collect links from open_syllabus/all
url_list = []
try:
    r = requests.get(BASE_URL + 'all?display_lang=jp', headers={'User-Agent': 'Mozilla/5.0'}, timeout=15)
    html = r.content.decode('cp932', errors='ignore')
    soup = BeautifulSoup(html, 'html.parser')
    for a in soup.find_all('a', href=True):
        href = a['href']
        if 'la_syllabus?lectureNo=' in href or 'department_syllabus?lectureNo=' in href:
            full_url = BASE_URL + href if not href.startswith('http') else href
            if 'display_lang' not in full_url:
                full_url += '&display_lang=jp'
            url_list.append(full_url)
except Exception as e:
    print(f"一覧取得エラー: {e}")

url_list = list(dict.fromkeys(url_list))
print(f"検出されたユニーク授業URL: {len(url_list)} 件")

def parse_kulasis_url(url):
    try:
        r = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=8)
        html = r.content.decode('cp932', errors='ignore')
        soup = BeautifulSoup(html, 'html.parser')

        class_name = ""
        instructor = ""
        affiliation = ""
        datetime_str = ""

        tds = soup.find_all('td')
        for i, td in enumerate(tds):
            txt = td.get_text(strip=True)

            if '(科目名)' in txt and i + 1 < len(tds):
                class_name = tds[i+1].get_text(strip=True)

            if '(氏 名)' in txt and i + 3 < len(tds):
                instructor = tds[i+3].get_text(strip=True)
            elif '(所属部局)' in txt and i + 3 < len(tds):
                affiliation = tds[i+3].get_text(strip=True)

            if '(曜時限)' in txt and i + 1 < len(tds):
                datetime_str = tds[i+1].get_text(strip=True)

        if not instructor:
            for i, td in enumerate(tds):
                txt = td.get_text(strip=True)
                if '(担当教員)' in txt and i + 1 < len(tds):
                    instructor = tds[i+1].get_text(strip=True)
                    break

        if class_name:
            day = "Mon"
            period = 1
            for jp_d, en_d in DAY_MAP.items():
                if jp_d in datetime_str:
                    day = en_d
                    break
            pm = re.search(r'(\d+)', datetime_str)
            if pm:
                p_num = int(pm.group(1))
                if 1 <= p_num <= 5:
                    period = p_num

            # Determine faculty
            fac = '全学共通'
            if affiliation and affiliation != '国際高等教育院':
                for f_name in ['文学部', '教育学部', '法学部', '経済学部', '理学部', '医学部', '薬学部', '工学部', '農学部', '総合人間学部']:
                    if f_name in affiliation:
                        fac = f_name
                        break
            if fac == '全学共通':
                if re.search(r'工学|機械|電気|電子|情報|建築|土木|材料|化学工学|原子|量子|システム|物理工学|工業', class_name):
                    fac = '工学部'
                elif re.search(r'法|憲法|民法|刑法|行政|商法|労働法|国際法|政治|統治', class_name):
                    fac = '法学部'
                elif re.search(r'経済|経営|会計|金融|ミクロ|マクロ|財政|統計学', class_name):
                    fac = '経済学部'
                elif re.search(r'代数学|解析学|幾何学|代数|解析|幾何|物理学|化学|生物学', class_name):
                    fac = '理学部'
                elif re.search(r'文学|歴史|史学|哲学|社会学|心理学|美学|宗教学', class_name):
                    fac = '文学部'
                elif re.search(r'農学|農芸|応用生命|食品|森林|資源|農業', class_name):
                    fac = '農学部'
                elif re.search(r'医学|解剖|生理学|薬理学|病理|臨床|薬学', class_name):
                    fac = '医学部/薬学部'
                elif re.search(r'人間|人間科学|認知|文明', class_name):
                    fac = '総合人間学部'

            cat = '全学共通科目' if fac == '全学共通' else '専門科目'

            return {
                'name': class_name,
                'faculty': fac,
                'dayOfWeek': day,
                'period': period,
                'lecturer': instructor or '京大 教授',
                'category': cat,
                'url': url
            }
    except Exception:
        pass
    return None

print(f"2. {len(url_list[:1200])} 件の公式シラバスの詳細情報を高速取得中...")

results = []
with ThreadPoolExecutor(max_workers=30) as executor:
    futures = [executor.submit(parse_kulasis_url, u) for u in url_list[:1200]]
    done = 0
    for fut in as_completed(futures):
        res = fut.result()
        if res:
            results.append(res)
            done += 1
            if done % 100 == 0:
                print(f"取得済み: {done} 件 (例: {res['name']} - 担当: {res['lecturer']} - 学部: {res['faculty']})")

print(f"\n完了！ 合計 {len(results)} 件の最新公式シラバスデータ取得完了！")

with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
    json.dump(results, f, ensure_ascii=False, indent=4)

lines = []
lines.append("import '../models/subject.dart';")
lines.append("")
lines.append("class KulasisDataset {")
lines.append("  static final List<Subject> sampleSubjects = [")

def escape_str(s):
    return s.replace('\\', '\\\\').replace("'", "\\'").replace('$', '\\$').replace('\n', ' ')

for idx, c in enumerate(results, 1):
    lines.append(f"    Subject(id: 'ku_official_{idx}', name: '{escape_str(c['name'])}', faculty: '{escape_str(c['faculty'])}', dayOfWeek: '{c['dayOfWeek']}', period: {c['period']}, lecturer: '{escape_str(c['lecturer'])}', category: '{escape_str(c['category'])}'),")

lines.append("  ];")
lines.append("")
lines.append("  static List<Subject> getSubjectsForSlot(String dayOfWeek, int period, {String? facultyFilter}) {")
lines.append("    return sampleSubjects.where((s) {")
lines.append("      final matchSlot = s.dayOfWeek == dayOfWeek && s.period == period;")
lines.append("      if (!matchSlot) return false;")
lines.append("      if (facultyFilter != null && facultyFilter.isNotEmpty && facultyFilter != 'すべて') {")
lines.append("        return s.faculty == facultyFilter;")
lines.append("      }")
lines.append("      return true;")
lines.append("    }).toList();")
lines.append("  }")
lines.append("")
lines.append("  static Subject? findById(String id) {")
lines.append("    try {")
lines.append("      return sampleSubjects.firstWhere((s) => s.id == id);")
lines.append("    } catch (_) {")
lines.append("      return null;")
lines.append("    }")
lines.append("  }")
lines.append("}")

with open(OUTPUT_DART, 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))

print(f"Dartマスタ {OUTPUT_DART} に {len(results)} 件を書き込みました！")
