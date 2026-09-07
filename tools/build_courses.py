"""Normalize the scraped KULASIS/open-syllabus dump into a clean courses.json.

Source: tools/source/syllabus_data.json (see tools/README.md for provenance).
Output: tools/courses.json
"""
import json, re, sys, unicodedata, hashlib, pathlib

HERE = pathlib.Path(__file__).parent
SRC = HERE / "source" / "syllabus_data.json"
OUT = HERE / "courses.json"

# Lecturer names invented by the old parse_existing_json_official.py when the real
# value was missing. Any of these -> treat as unknown.
FABRICATED_LECTURERS = {
    "橘 邦英 教授", "佐藤 彰彦 教授", "中村 健太郎 教授", "高橋 正樹 教授", "山本 哲也 教授", "小林 義明 教授",
    "安藤 智子 教授", "木村 慎一 教授", "井上 剛 教授", "佐々木 健 教授", "渡辺 浩 教授",
    "山極 壽一 教授", "加藤 裕樹 教授", "吉田 拓也 教授", "松本 隆 教授", "藤田 茂 教授",
    "長谷川 勝 教授", "清水 博 教授", "岡田 秀樹 教授", "三浦 健 教授", "坂本 龍 教授",
    "西田 幾多郎 教授", "河野 哲也 教授", "中川 聡 教授", "杉山 英樹 教授", "原田 實 教授",
    "川崎 勉 教授", "平野 薫 教授", "大野 誠 教授", "竹内 敬 教授", "石川 陽一 教授",
    "本庶 佑 特命教授", "山中 伸弥 教授", "福井 次郎 教授", "前田 裕 教授", "橋本 卓 教授",
    "桑野 隆 教授", "市川 寛 教授", "田村 研一 教授", "野口 豊 教授",
    "生田 久美子 教授", "大浦 容子 教授", "楠見 孝 教授",
    "京大教養部 教授", "国際高等教育院 講師", "全学共通科目 担当教員",
}
UNKNOWN_LECTURER = "担当教員不明"
DEFAULT_CATEGORY = "全学共通科目"
VALID_DAYS = {"Mon", "Tue", "Wed", "Thu", "Fri"}


def normalize_text(s: str) -> str:
    s = unicodedata.normalize("NFKC", s or "")
    s = re.sub(r"\s+", " ", s).strip()
    # Display normalization: collapse whitespace runs to a single space, do NOT
    # remove inner spaces. courseKey building uses _key_norm instead.
    return s


def _key_norm(s: str) -> str:
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", s or "")).strip().lower()


def course_key(name: str, lecturer: str) -> str:
    return f"{_key_norm(name)}|{_key_norm(lecturer)}"


def doc_id(course_key_str: str, day: str, period: int) -> str:
    h = hashlib.sha1(f"{course_key_str}|{day}|{period}".encode("utf-8")).hexdigest()[:16]
    return f"c_{h}"


def _clean_lecturer(raw: str) -> str:
    v = normalize_text(raw)
    if not v or v in {"担当教員未定", "未定"} or v in FABRICATED_LECTURERS:
        return UNKNOWN_LECTURER
    return v


def _clean_period(raw) -> int:
    m = re.search(r"\d+", str(raw or ""))
    if not m:
        return 1
    p = int(m.group(0))
    return p if 1 <= p <= 5 else 1


def build(rows: list[dict]) -> list[dict]:
    seen: dict[str, dict] = {}
    for item in rows:
        name = normalize_text(item.get("name") or "")
        if not name:
            continue
        day = (item.get("dayOfWeek") or "").strip()
        if day not in VALID_DAYS:
            continue
        period = _clean_period(item.get("period"))
        lecturer = _clean_lecturer(item.get("lecturer") or "")
        faculty = normalize_text(item.get("faculty") or "") or "全学共通"
        # M1: the source rows carry a category ('全学共通科目' for the 全学共通
        # rows). Without it every seeded course fell back to CourseRepository's
        # '専門/教養' default and the 区分 shown in the picker was wrong.
        category = normalize_text(item.get("category") or "") or DEFAULT_CATEGORY
        ck = course_key(name, lecturer)
        did = doc_id(ck, day, period)
        if did in seen:
            continue
        seen[did] = {
            "id": did,
            "courseKey": ck,
            "name": name,
            "faculty": faculty,
            "lecturer": lecturer,
            "dayOfWeek": day,
            "period": period,
            "category": category,
            "university_id": "kyoto_u",
        }
    return sorted(seen.values(), key=lambda c: (c["name"], c["dayOfWeek"], c["period"]))


def main() -> int:
    rows = json.loads(SRC.read_text(encoding="utf-8"))
    courses = build(rows)
    OUT.write_text(json.dumps(courses, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {len(courses)} courses -> {OUT}")
    if not (2000 <= len(courses) <= 12000):
        print(f"WARNING: course count {len(courses)} outside the expected 2000-12000 range", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
