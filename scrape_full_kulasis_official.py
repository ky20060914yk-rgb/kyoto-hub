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
    '80': ('全学共通', '全学共通科目'),
    '1': ('文学部', '専門科目'),
    '4': ('教育学部', '専門科目'),
    '6': ('法学部', '専門科目'),
    '8': ('経済学部', '専門科目'),
    '10': ('理学部', '専門科目'),
    '12': ('医学部', '専門科目'),
    '14': ('薬学部', '専門科目'),
    '16': ('工学部', '専門科目'),
    '18': ('農学部', '専門科目'),
    '61': ('総合人間学部', '専門科目'),
}

DAY_MAP = { '月': 'Mon', '火': 'Tue', '水': 'Wed', '木': 'Thu', '金': 'Fri', '土': 'Sat' }

print("1. 京都大学 KULASIS 公式学部別シラバス一覧を取得中...")

all_course_targets = []

for dept_code, (fac_name, default_cat) in DEPARTMENTS.items():
    search_url = f'{BASE_URL}search?condition.departmentNo={dept_code}&display_lang=jp'
    try:
        res = requests.get(search_url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=15)
        res.encoding = 'windows-31j'
        soup = BeautifulSoup(res.text, 'html.parser')

        links = [a['href'] for a in soup.find_all('a', href=True) if 'syllabus' in a['href'] and ('la_syllabus' in a['href'] or 'department_syllabus' in a['href'])]
        links = list(dict.fromkeys(links))

        for l in links:
            full_url = BASE_URL + l if not l.startswith('http') else l
            if 'display_lang' not in full_url:
                full_url += '&display_lang=jp'
            all_course_targets.append({
                'url': full_url,
                'faculty': fac_name,
                'category': default_cat
            })
        print(f"・{fac_name} ({dept_code}): {len(links)} 件の授業リンクを検出")
    except Exception as e:
        print(f"エラー: {fac_name} の取得失敗: {e}")

print(f"\n合計 {len(all_course_targets)} 件の全学部公式シラバス詳細のスクレイピングを開始します...")

scraped_results = []

def parse_course_detail(item):
    url = item['url']
    fac_name = item['faculty']
    cat_name = item['category']

    try:
        r = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=10)
        r.encoding = 'windows-31j'
        soup = BeautifulSoup(r.text, 'html.parser')

        class_name = ""
        lecturer = ""
        day = "Mon"
        period = 1

        # 科目名 (授業名)
        for th_kw in ['(科目名)', '科目名']:
            th_sub = soup.find(lambda t: t.name in ['span', 'td', 'th'] and th_kw in t.get_text())
            if th_sub:
                parent_td = th_sub.find_parent('td')
                if parent_td:
                    next_td = parent_td.find_next_sibling('td')
                    if next_td:
                        class_name = next_td.get_text(separator=' ', strip=True)
                        break

        # 担当教員
        for th_kw in ['(担当教員)', '担当教員']:
            th_inst = soup.find(lambda t: t.name in ['span', 'td', 'th'] and th_kw in t.get_text())
            if th_inst:
                tr_h = th_inst.find_parent('tr')
                if tr_h:
                    tr_v = tr_h.find_next_sibling('tr')
                    if tr_v:
                        td_inst = tr_v.find('td')
                        if td_inst:
                            lecturer = td_inst.get_text(separator=' ', strip=True)
                            break
                    else:
                        td_inst = tr_h.find_next_sibling('td')
                        if td_inst:
                            lecturer = td_inst.get_text(separator=' ', strip=True)
                            break

        # 曜時限
        for th_kw in ['(曜時限)', '曜時限']:
            th_dt = soup.find(lambda t: t.name in ['span', 'td', 'th'] and th_kw in t.get_text())
            if th_dt:
                parent_td = th_dt.find_parent('td')
                if parent_td:
                    next_td = parent_td.find_next_sibling('td')
                    if next_td:
                        dt_str = next_td.get_text(separator=' ', strip=True)
                        for jp_d, en_d in DAY_MAP.items():
                            if jp_d in dt_str:
                                day = en_d
                                break
                        pm = re.search(r'(\d+)', dt_str)
                        if pm:
                            p_num = int(pm.group(1))
                            if 1 <= p_num <= 5:
                                period = p_num
                        break

        if class_name:
            # Clean class name & lecturer
            class_name = re.sub(r'\(.*?\)', '', class_name).strip() or class_name
            lecturer = lecturer.replace('|', ' ').strip() or '京都大学教員'

            return {
                'name': class_name,
                'faculty': fac_name,
                'dayOfWeek': day,
                'period': period,
                'lecturer': lecturer,
                'category': cat_name,
                'url': url
            }
    except Exception:
        pass
    return None

processed_courses = []
with ThreadPoolExecutor(max_workers=30) as executor:
    futures = [executor.submit(parse_course_detail, item) for item in all_course_targets]
    done_count = 0
    for fut in as_completed(futures):
        res_course = fut.result()
        if res_course:
            processed_courses.append(res_course)
            done_count += 1
            if done_count % 100 == 0 or done_count == len(all_course_targets):
                print(f"進捗: {done_count}/{len(all_course_targets)} 件の教員名・時限データを取得完了...")

print(f"\n合計 {len(processed_courses)} 件の公式全学部シラバス（正確な担当教員名つき）のスクレイピング完了！")

# Save JSON
with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
    json.dump(processed_courses, f, ensure_ascii=False, indent=4)

# Generate Dart file
lines = []
lines.append("import '../models/subject.dart';")
lines.append("")
lines.append("class KulasisDataset {")
lines.append("  static final List<Subject> sampleSubjects = [")

def escape_str(s):
    return s.replace('\\', '\\\\').replace("'", "\\'").replace('$', '\\$').replace('\n', ' ')

for idx, c in enumerate(processed_courses, 1):
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

print(f"Dartマスタ {OUTPUT_DART} に {len(processed_courses)} 件の公式データを書き込みました！")
