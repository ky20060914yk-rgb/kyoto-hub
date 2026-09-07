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

DAY_MAP = { '月': 'Mon', '火': 'Tue', '水': 'Wed', '木': 'Thu', '金': 'Fri', '土': 'Sat' }

print("1. KULASIS から全学部・全学科の公式シラバスリンクを収集しています...")

all_links = []

# A. 全学共通 (open_syllabus/all)
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
            all_links.append((full_url, '全学共通'))
    print(f"・全学共通 (open_syllabus/all): {len(all_links)} 件のリンク検出")
except Exception as e:
    print(f"全学共通取得エラー: {e}")

# B. 学部別 (departmentNo 1..61)
for dept_code, fac_name in DEPARTMENTS.items():
    if dept_code == '80':
        continue
    dept_url = f'{BASE_URL}search?condition.departmentNo={dept_code}&display_lang=jp'
    try:
        r = requests.get(dept_url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=15)
        html = r.content.decode('cp932', errors='ignore')
        soup = BeautifulSoup(html, 'html.parser')
        cnt = 0
        for a in soup.find_all('a', href=True):
            href = a['href']
            if 'department_syllabus?lectureNo=' in href or 'la_syllabus?lectureNo=' in href:
                full_url = BASE_URL + href if not href.startswith('http') else href
                if 'display_lang' not in full_url:
                    full_url += '&display_lang=jp'
                all_links.append((full_url, fac_name))
                cnt += 1
        print(f"・{fac_name} (deptNo={dept_code}): {cnt} 件のリンク検出")
    except Exception as e:
        print(f"学部エラー ({fac_name}): {e}")

# 重複排除
unique_targets = {}
for url, fac in all_links:
    if url not in unique_targets:
        unique_targets[url] = fac

print(f"\n全 {len(unique_targets)} 件の独立したシラバス詳細の並列スクレイピングを開始します...")

def parse_kulasis_detail(target):
    url, default_fac = target
    try:
        r = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=10)
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

        # Fallback for instructor if not matched by label
        if not instructor:
            for i, td in enumerate(tds):
                txt = td.get_text(strip=True)
                if '(担当教員)' in txt and i + 1 < len(tds):
                    instructor = tds[i+1].get_text(strip=True)
                    break

        if class_name:
            # Parse day & period
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
            fac = default_fac
            if affiliation and affiliation != '国際高等教育院':
                for f_name in ['文学部', '教育学部', '法学部', '経済学部', '理学部', '医学部', '薬学部', '工学部', '農学部', '総合人間学部']:
                    if f_name in affiliation:
                        fac = f_name
                        break

            category = '全学共通科目' if fac == '全学共通' else '専門科目'

            return {
                'name': class_name,
                'faculty': fac,
                'dayOfWeek': day,
                'period': period,
                'lecturer': instructor or '京都大学教員',
                'category': category,
                'url': url
            }
    except Exception:
        pass
    return None

scraped_data = []
with ThreadPoolExecutor(max_workers=30) as executor:
    futures = [executor.submit(parse_kulasis_detail, item) for item in unique_targets.items()]
    done = 0
    for fut in as_completed(futures):
        res_course = fut.result()
        if res_course:
            scraped_data.append(res_course)
            done += 1
            if done % 200 == 0 or done == len(unique_targets):
                print(f"進捗: {done}/{len(unique_targets)} 件の科目名・公式担当教員・時限データを取得完了...")

print(f"\n合計 {len(scraped_data)} 件の公式シラバスデータを正常スクレイピング完了！")

# Save JSON
with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
    json.dump(scraped_data, f, ensure_ascii=False, indent=4)

# Generate Dart file
lines = []
lines.append("import '../models/subject.dart';")
lines.append("")
lines.append("class KulasisDataset {")
lines.append("  static final List<Subject> sampleSubjects = [")

def escape_str(s):
    return s.replace('\\', '\\\\').replace("'", "\\'").replace('$', '\\$').replace('\n', ' ')

for idx, c in enumerate(scraped_data, 1):
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

print(f"Dartマスタ {OUTPUT_DART} に {len(scraped_data)} 件の公式シラバスデータを保存完了！")
