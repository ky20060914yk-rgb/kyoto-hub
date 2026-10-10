import subprocess, sys, json, pathlib
from build_courses import normalize_text, course_key, doc_id, build


def test_normalize_text_collapses_and_nfkc():
    assert normalize_text("  西洋 社会  思想史Ｉ ") == "西洋 社会 思想史I"
    assert normalize_text("ＡＢ　Ｃ") == "AB C"


def test_course_key_is_stable_and_slot_independent():
    a = course_key("微分積分学A", "山田 太郎")
    b = course_key("微分積分学Ａ", "山田　太郎")
    assert a == b


def test_doc_id_is_deterministic():
    k = course_key("哲学I", "戸田 剛文")
    assert doc_id(k, "Mon", 3) == doc_id(k, "Mon", 3)
    assert doc_id(k, "Mon", 3) != doc_id(k, "Tue", 3)


def test_build_drops_fabricated_lecturers_and_dedups(tmp_path):
    src = [
        {"name": "哲学I", "faculty": "全学共通", "dayOfWeek": "Mon", "period": 3, "lecturer": "戸田　剛文", "category": "全学共通科目"},
        {"name": "哲学I", "faculty": "全学共通", "dayOfWeek": "Mon", "period": 3, "lecturer": "戸田　剛文", "category": "全学共通科目"},
        {"name": "謎の講義", "faculty": "全学共通", "dayOfWeek": "Tue", "period": 1, "lecturer": "本庶 佑 特命教授", "category": "全学共通科目"},
    ]
    out = build(src)
    # exact duplicate collapsed
    assert len(out) == 2
    # fabricated-pool lecturer replaced with the unknown marker
    mystery = [c for c in out if c["name"] == "謎の講義"][0]
    assert mystery["lecturer"] == "担当教員不明"


def test_build_emits_the_full_document_shape():
    out = build([
        {"name": "哲学I", "faculty": "全学共通", "dayOfWeek": "Mon", "period": 3,
         "lecturer": "戸田　剛文", "category": "全学共通科目"},
    ])
    assert set(out[0]) == {
        "id", "courseKey", "name", "faculty", "lecturer", "dayOfWeek", "period",
        "category", "university_id",
    }


def test_category_is_carried_through_from_the_source(tmp_path):
    """M1: the seeded catalog must keep the source's 区分."""
    out = build([
        {"name": "哲学I", "faculty": "全学共通", "dayOfWeek": "Mon", "period": 3,
         "lecturer": "戸田　剛文", "category": "全学共通科目"},
        {"name": "専門ゼミ", "faculty": "工学部", "dayOfWeek": "Tue", "period": 1,
         "lecturer": "京大　太郎", "category": "専門科目"},
    ])
    by_name = {c["name"]: c for c in out}
    assert by_name["哲学I"]["category"] == "全学共通科目"
    assert by_name["専門ゼミ"]["category"] == "専門科目"


def test_category_falls_back_when_the_source_omits_it():
    out = build([
        {"name": "区分なし講義", "faculty": "全学共通", "dayOfWeek": "Wed", "period": 2,
         "lecturer": "京大　花子"},
    ])
    assert out[0]["category"] == "全学共通科目"


def test_generated_catalog_carries_a_category_for_every_course():
    """The committed tools/courses.json must be in sync with build()."""
    courses = json.loads((pathlib.Path(__file__).parent / "courses.json").read_text(encoding="utf-8"))
    assert len(courses) > 2000
    assert all(c.get("category") for c in courses)
    assert all(c.get("id") and c.get("courseKey") for c in courses)
    assert all(isinstance(c.get("period"), int) and 1 <= c["period"] <= 5 for c in courses)
    assert all(c.get("dayOfWeek") in {"Mon", "Tue", "Wed", "Thu", "Fri"} for c in courses)


def test_display_lecturer_drops_syllabus_metadata_and_kana_readings():
    from build_courses import display_lecturer
    assert display_lecturer("(配当学年)1回生以上(開講年度・開講期)2026・後期") == "担当教員不明"
    assert display_lecturer("(単位数)2単位(開講年度・開講期)2026・前期") == "担当教員不明"
    assert display_lecturer("稲富 宏之 (イナドミ ヒロユキ)") == "稲富 宏之"
    assert display_lecturer("Alireza Naghavi(アリレザ ナガヴィ)") == "Alireza Naghavi"
    assert display_lecturer("理学研究科") == "理学研究科"
    assert display_lecturer("戸田 剛文") == "戸田 剛文"


def test_display_fix_keeps_course_ids_stable():
    row = {"name": "生徒指導論", "faculty": "全学共通", "dayOfWeek": "Wed", "period": 4,
           "lecturer": "(配当学年)1回生以上(開講年度・開講期)2026・後期", "category": "全学共通科目"}
    out = build([row])[0]
    # the key (and so the document id) is still computed from the stored value
    assert out["courseKey"] == course_key("生徒指導論", "(配当学年)1回生以上(開講年度・開講期)2026・後期")
    assert out["lecturer"] == "担当教員不明"
