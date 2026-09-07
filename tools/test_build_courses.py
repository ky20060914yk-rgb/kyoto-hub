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
