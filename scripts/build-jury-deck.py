#!/usr/bin/env python3
"""Сборка презентации HandCheck для жюри ФСП из официального шаблона.

Вход:  docs/presentation/template-fsp-2026.pptx   (шаблон ФСП, слайды 1–37)
       handcheck-ui/presentation/*.png            (скриншоты кабинетов)
       context/metrics-assessment.json             (числа валидации)

Выход: docs/presentation/HandCheck-ФСП-2026.pptx

Запуск (из корня репозитория):
    python3 scripts/build-jury-deck.py
"""

import json
import os
import re
import shutil
import subprocess
import sys

from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.util import Emu, Inches, Pt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATE = os.path.join(ROOT, "docs", "presentation", "template-fsp-2026.pptx")
METRICS = os.path.join(ROOT, "context", "metrics-assessment.json")
SHOTS = os.path.join(ROOT, "handcheck-ui", "presentation")
OUT = os.path.join(ROOT, "docs", "presentation", "HandCheck-ФСП-2026.pptx")

PURPLE = RGBColor = None  # placeholder, real color set below


def rgb(hex_str):
    from pptx.dml.color import RGBColor

    return RGBColor.from_string(hex_str.replace("#", "").upper())


BRAND = rgb("520978")
ACCENT = rgb("FF0053")
INK = rgb("1C1D22")
GREY = rgb("8A83D1")


def delete_slides(prs, keep):
    """Оставить в презентации только слайды из множества keep (0-based)."""
    id_list = prs.slides._sldIdLst
    rel_ns = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
    for pos, sld in enumerate(list(id_list)):
        if pos in keep:
            continue
        prs.part.drop_rel(sld.get(rel_ns))
        id_list.remove(sld)


def no_bullet(paragraph):
    from pptx.oxml.ns import qn

    p_pr = paragraph._p.get_or_add_pPr()
    for tag in ("a:buChar", "a:buAutoNum", "a:buNone"):
        for el in p_pr.findall(qn(tag)):
            p_pr.remove(el)
    p_pr.append(p_pr.makeelement(qn("a:buNone"), {}))


def set_lines(tf, lines, size=None, bold=False, color=None, bullet=False, space_after=4, align=None):
    """Заполнить текстовый фрейм строками, задав шрифт явно."""
    tf.clear()
    tf.word_wrap = True
    for i, line in enumerate(lines if isinstance(lines, (list, tuple)) else [lines]):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.text = line
        if align is not None:
            p.alignment = align
        p.space_after = Pt(space_after)
        if not bullet:
            no_bullet(p)
        for target in [p.font] + [r.font for r in p.runs]:
            if size:
                target.size = Pt(size)
            if bold:
                target.bold = True
            if color is not None:
                target.color.rgb = color
    return tf


def ph_by_idx(slide, idx):
    for ph in slide.placeholders:
        if ph.placeholder_format.idx == idx:
            return ph
    return None


def shape_by_name(slide, needle, occurrence=0):
    hits = [s for s in slide.shapes if needle in s.name]
    return hits[occurrence] if len(hits) > occurrence else None


def shape_by_text(slide, needle):
    """Найти текстовый блок по куску его текущего текста."""
    for sh in slide.shapes:
        if sh.has_text_frame and needle in sh.text_frame.text:
            return sh
    return None


def text_of(shape):
    return shape.text_frame.text if shape.has_text_frame else ""


def set_shape_lines(shape, lines, **kw):
    return set_lines(shape.text_frame, lines, **kw)


def drop_placeholder(slide, idx):
    ph = ph_by_idx(slide, idx)
    if ph is not None:
        ph._element.getparent().remove(ph._element)


def place_image(slide, path, box, crop_fill=True):
    """Вставить картинку в бокс (left, top, width, width в дюймах), при необходимости обрезав."""
    left, top, w, h = box
    pic = slide.shapes.add_picture(path, Inches(left), Inches(top), Inches(w), Inches(h))
    if crop_fill:
        from PIL import Image

        with Image.open(path) as im:
            img_aspect = im.width / im.height
        box_aspect = w / h
        if img_aspect > box_aspect:
            keep = box_aspect / img_aspect
            c = (1 - keep) / 2
            pic.crop_left = c
            pic.crop_right = c
        elif img_aspect < box_aspect:
            keep = img_aspect / box_aspect
            c = (1 - keep) / 2
            pic.crop_top = c
            pic.crop_bottom = c
    return pic


def strip_layout_sample_text(prs):
    """Убрать служебные подписи «Образец текста» из макетов шаблона.

    В шаблоне ФСП примеры текста лежат не в плейсхолдерах слайда, а в макетах,
    поэтому они видны даже на заполненных слайдах.
    """
    from pptx.oxml.ns import qn

    removed = 0
    for layout in prs.slide_layouts:
        for shape in list(layout.shapes):
            if not shape.has_text_frame:
                continue
            texts = [p.text for p in shape.text_frame.paragraphs]
            if not texts or not all(("Образец текста" in t) or not t.strip() for t in texts):
                continue
            shape._element.getparent().remove(shape._element)
            removed += 1
    return removed


def set_pill_title(slide, title, size=17):
    """Заголовок слайдов с цветной плашкой пишем прямо в плашку."""
    pill = None
    for sh in slide.shapes:
        if sh.is_placeholder or not sh.has_text_frame:
            continue
        if sh.top is not None and Emu(sh.top).inches < 0.9 and Emu(sh.height).inches < 1.1:
            if Emu(sh.width).inches > 2.5:
                pill = sh
                break
    if pill is not None:
        set_lines(pill.text_frame, [title], size=size, bold=True, color=rgb("FFFFFF"))
        return True
    for ph in slide.placeholders:
        if ph.placeholder_format.idx == 0:
            set_lines(ph.text_frame, [title], size=size, bold=True, color=ACCENT)
            return True
    return False


def main():
    if not os.path.exists(TEMPLATE):
        sys.exit(f"Нет шаблона: {TEMPLATE}")
    # Источники чисел в тексте слайдов (проверить перед сдачей, если аудит изменится):
    #   41 и 8 проверок      → context/audits/*.md (scripts/functional-audit.js)
    #   162 задания, 9 барей, 9/9 ячеек, cutoff, Δ форм, 0.734/0.000
    #                        → context/metrics-assessment.json (scripts/assessment-metrics.js)
    #   0.60/0.15/0.10/0.15  → app/lib/ranking.js
    #   30 дней кулдауна     → app/config.js GRADE_COOLDOWN_DAYS
    #   40 / 2 / 3 пунктов ТЗ→ docs/FUNCTIONAL-COVERAGE.md
    metrics = {}
    if os.path.exists(METRICS):
        metrics = json.load(open(METRICS))
    prs = Presentation(TEMPLATE)
    removed = strip_layout_sample_text(prs)
    print(f"Убрано служебных подписей из макетов: {removed}")
    slides = list(prs.slides)

    # Оставляем контентные слайды шаблона 7..24 (1-based) → индексы 6..23
    keep = set(range(6, 24))
    delete_slides(prs, keep)
    slides = list(prs.slides)

    # ---------- 1. Титульный ----------
    s = slides[0]
    set_lines(ph_by_idx(s, 0).text_frame, ["HandCheck"], size=54, bold=True, color=rgb("FFFFFF"))
    set_lines(ph_by_idx(s, 12).text_frame,
              ["Категорию даёт тест. Приглашение даёт работодатель."],
              size=18, color=rgb("FFD6E4"))

    # ---------- 2. О команде + суть ----------
    s = slides[1]
    set_lines(ph_by_idx(s, 0).text_frame, ["Категорию даёт батарея"], size=22, bold=True, color=BRAND)
    photo = ph_by_idx(s, 10)
    if photo is not None and photo.has_text_frame:
        set_lines(photo.text_frame, ["[ фото команды ]"], size=12, color=GREY)
    set_shape_lines(shape_by_text(s, "Капитан: ФИО"),
                    ["Капитан: [ФИО, специальность]",
                     "Кол-во участников: [__] человек",
                     "Краткое описание: [место работы / учёбы участников]",
                     "Город и регион: [город]"],
                    size=12, color=INK)
    set_shape_lines(shape_by_text(s, "В чем суть вашего решения"),
                    ["Соискатель проходит опрос и батарею — получает категорию "
                     "«специализация × грейд». Работодатель ищет по категории и сам "
                     "приглашает с вилкой ЗП. Контакты открываются только после согласия."],
                    size=12, color=INK)
    set_shape_lines(shape_by_text(s, "Что делает ваше решение уникальным"),
                    ["Это не витрина вакансий и не отклики вслепую: выдача идёт по измеренной "
                     "категории, а приглашение — осознанный шаг с обеих сторон."],
                    size=12, color=INK)

    # ---------- 3. Команда (заполнить участников) ----------
    s = slides[2]
    set_pill_title(s, "Команда")
    for tb in [sh for sh in s.shapes if sh.has_text_frame and "Имя Фамилия" in text_of(sh)]:
        set_shape_lines(tb, ["Имя Фамилия"], size=12, bold=True, color=BRAND)
    for tb in [sh for sh in s.shapes if sh.has_text_frame and "Роль в команде" in text_of(sh)]:
        set_shape_lines(tb, ["Роль: [роль в команде]",
                             "Ник: [@telegram]",
                             "Телефон: [+7 …]",
                             "Место работы/учёбы: [место]"],
                        size=9, color=INK)

    # ---------- 4. Краткая история ----------
    s = slides[3]
    set_pill_title(s, "Краткая история команды", size=15)
    set_lines(ph_by_idx(s, 27).text_frame,
              ["Рекрутинг для ИТ упирается в совпадение ключевых слов: резюме фиксирует стек, "
               "но не подтверждает навык. Мы строим площадку, где квалификацию проверяют, "
               "а не декларируют."],
              size=12, color=INK)
    set_shape_lines(shape_by_text(s, "Что вас вдохновило"),
                    ["Самый сложный блок — устойчивость теста. Отказались от уникальной генерации "
                     "под каждого кандидата: взяли банк заданий с двумя параллельными формами "
                     "и cutoff по грейду, плюс серверные дедлайны и кулдаун пересдачи."],
                    size=12, color=INK)
    set_shape_lines(shape_by_text(s, "Расскажите о самых интересных"),
                    ["Каждое изменение проверяли автоматически: юнит-тесты, процедура валидации "
                     "теста и подбора, плюс сквозной функциональный аудит из 41 проверки — "
                     "на своём стенде и в читающем режиме на проде."],
                    size=12, color=INK)

    # ---------- 5. Коротко о решении ----------
    s = slides[4]
    set_lines(ph_by_idx(s, 38).text_frame,
              ["Node.js + Express + SQLite, статический UI без SPA-фреймворка",
               "Банк из 162 заданий: 9 батарей (backend / frontend / QA × junior / middle / senior)",
               "Серверные дедлайны, черновики, телеметрия попыток, cutoff 0.55 / 0.68 / 0.78",
               "Подбор: категория → rank = 0.60·тест + 0.15·мотивация + 0.10·ФСП + 0.15·домен",
               "LLM — только черновики заданий работодателю; оценка кандидата всегда по банку"],
              size=13, color=INK, bullet=True)
    set_lines(ph_by_idx(s, 42).text_frame,
              ["Рекрутер перестаёт разбирать сотни анкет: получает готовую категорию с обоснованием",
               "Кандидат не откликается вслепую — инициатива у работодателя, как в LHH / Hired",
               "Участники соревновательного движения конвертируют навыки в оффер, а не в строчку резюме",
               "Контакты скрыты до accept: меньше спама, выше вовлечённость обеих сторон"],
              size=13, color=INK, bullet=True)

    # ---------- 6. Как это работает (4 шага) ----------
    s = slides[5]
    set_lines(ph_by_idx(s, 0).text_frame, ["Как это работает"], size=28, bold=True, color=rgb("FFFFFF"))
    for ph in s.placeholders:
        if ph.placeholder_format.idx == 4:
            set_lines(ph.text_frame, [""], size=10, color=rgb("FFFFFF"))
    set_lines(ph_by_idx(s, 1).text_frame,
              ["1. Опрос → специализация и заявленный грейд",
               "",
               "2. Батарея: 8 коротких вопросов с дедлайном + мини-проект",
               "",
               "3. Категория = специализация × грейд, если score ≥ cutoff",
               "",
               "4. Работодатель → подборка → приглашение с вилкой → accept → контакты"],
              size=15, color=INK, space_after=6)

    # ---------- 7. Проблема ----------
    s = slides[6]
    set_lines(ph_by_idx(s, 0).text_frame, ["Почему резюме не работает"], size=28, bold=True, color=rgb("FFFFFF"))
    set_lines(ph_by_idx(s, 1).text_frame,
              ["Категория «junior backend» сегодня значит что угодно: от «вчера написал hello world» "
               "до «полгода в продакшене».",
               "",
               "Работодатель тратит время дорогих специалистов на ручной отбор анкет, "
               "кандидат откликается вслепую и не получает обратной связи.",
               "",
               "Справочник специализаций и грейдов не формализован, поэтому релевантность выдачи "
               "низка у обеих сторон.",
               "",
               "Универсальные площадки не умеют говорить с ИТ на профессиональном языке — "
               "и не могут подтвердить навык объективно."],
              size=16, color=INK, space_after=6)

    # ---------- 8. Колода (картинка справа) ----------
    s = slides[7]
    set_pill_title(s, "Кабинет работодателя", size=15)
    set_lines(ph_by_idx(s, 14).text_frame,
              ["Колода показывает по одному кандидату: категория, стек, опыт в домене потребности "
               "и обоснование «почему он здесь».",
               "",
               "Контактов в карточке нет — они появятся только после принятия приглашения.",
               "",
               "Решения «отложить» и «отказать» учитываются: повторное приглашение тому же "
               "кандидату система не предложит."],
              size=13, color=INK, space_after=8)
    drop_placeholder(s, 10)
    place_image(s, os.path.join(SHOTS, "02-employer-deck.png"), (6.85, 1.55, 6.3, 3.94), crop_fill=False)

    # ---------- 9. Сквозной сценарий (5 пунктов) ----------
    s = slides[8]
    set_pill_title(s, "Сквозной сценарий", size=15)
    steps = [
        "Регистрация → подтверждение email → согласие на обработку данных",
        "Опрос: специализация и заявленный грейд → старт батареи (форма A или B)",
        "Тест по шагам: серверный дедлайн, черновик, телеметрия → категория и cooldown",
        "Работодатель: потребность → подборка по категории → приглашение с вилкой 120–180 тыс. ₽",
        "Кандидат принимает → контакты раскрыты; отказ → статус declined у обеих сторон",
    ]
    for i, idx in enumerate([15, 16, 17, 18, 19]):
        set_lines(ph_by_idx(s, idx).text_frame, [f"{i + 1}. {steps[i]}"], size=14, color=INK)

    # ---------- 10. Тест: 4 карточки ----------
    s = slides[9]
    set_pill_title(s, "Тест, устойчивый к утечкам", size=15)
    cards = [
        ("Банк заданий", "162 опубликованных задания в 9 батареях: backend / frontend / QA × junior / middle / senior"),
        ("Две формы", "В каждой ячейке формы A и B равноценны: Δ среднего балла на одинаковых ответах = 0.00"),
        ("Cutoff по грейду", "junior 0.55 · middle 0.68 · senior 0.78. Ниже порога — статус «не подтверждён», а не понижение грейда"),
        ("Дедлайны и кулдаун", "Таймер считает сервер, ответ сохраняется черновиком, пересдача — раз в 30 дней"),
    ]
    for i, (title, body) in enumerate(cards):
        set_lines(ph_by_idx(s, 49 + i).text_frame, [str(i + 1)], size=20, bold=True, color=ACCENT)
        set_lines(ph_by_idx(s, 37 + 2 * i).text_frame, [title], size=15, bold=True, color=BRAND)
        set_lines(ph_by_idx(s, 38 + 2 * i).text_frame, [body], size=12, color=INK)

    # ---------- 11. Механика подбора: 3 карточки ----------
    s = slides[10]
    set_pill_title(s, "Обратная механика подбора", size=14)
    picks = [
        ("Категория", "Специализация × грейд по результату батареи. Видна работодателю, подтверждена тестом, а не резюме."),
        ("Подборка", "Потребность → категория → ранжированный список с объяснением. Фильтры по стеку и ФСП только сужают выдачу."),
        ("Приглашение", "Работодатель сам зовёт с вилкой ЗП — вакансия не нужна. Контакты открываются после accept."),
    ]
    for i, (title, body) in enumerate(picks):
        set_lines(ph_by_idx(s, 49 + i).text_frame, [f"0{i + 1}"], size=20, bold=True, color=ACCENT)
        set_lines(ph_by_idx(s, 37 + 2 * i).text_frame, [title], size=17, bold=True, color=BRAND)
        set_lines(ph_by_idx(s, 38 + 2 * i).text_frame, [body], size=13, color=INK)

    # ---------- 12. Приватность: 6 блоков ----------
    s = slides[11]
    set_pill_title(s, "Приватность как механика", size=15)
    priv = [
        ("Согласие", "Обязательно при регистрации и при старте батареи, с текстом 152-ФЗ"),
        ("Контакты", "До accept в API работодателя нет phone и contact_email — 403 и пустые поля"),
        ("Оценка", "Балл теста и метрики честности не отдаются кандидату и работодателю"),
        ("Роли", "Кандидат не видит employer-API, работодатель — приватные поля кандидата"),
        ("ИИ-клиенты", "Токен MCP с согласием, аудит вызовов и отзыв токена; на REST токен не действует"),
        ("Сквозные тесты", "validate:privacy проверяет «invite sent → контактов нет, accept → контакты есть»"),
    ]
    for i, (title, body) in enumerate(priv):
        set_lines(ph_by_idx(s, 49 + i).text_frame, [str(i + 1)], size=16, bold=True, color=ACCENT)
        set_lines(ph_by_idx(s, 37 + 2 * i).text_frame, [title], size=14, bold=True, color=BRAND)
        set_lines(ph_by_idx(s, 38 + 2 * i).text_frame, [body], size=11, color=INK)

    # ---------- 13. Кандидатский кабинет (3 фото) ----------
    s = slides[12]
    set_pill_title(s, "Кабинет кандидата", size=15)
    set_lines(ph_by_idx(s, 14).text_frame,
              ["Статус категории и приглашения — на одном экране.",
               "",
               "После accept открывается короткий тест",
               "работодателя и комната звонка с записью."],
              size=13, color=INK, space_after=8)
    for idx, shot in ((10, "08-candidate-today.png"), (11, "09-candidate-invitations.png"), (12, "10-candidate-tasks.png")):
        drop_placeholder(s, idx)
    place_image(s, os.path.join(SHOTS, "08-candidate-today.png"), (8.1, 1.1, 4.8, 3.4))
    place_image(s, os.path.join(SHOTS, "09-candidate-invitations.png"), (8.1, 4.8, 4.8, 2.0))
    place_image(s, os.path.join(SHOTS, "10-candidate-tasks.png"), (0.4, 3.5, 7.4, 3.3))

    # ---------- 14. Архитектура ----------
    s = slides[13]
    set_pill_title(s, "Архитектура", size=15)
    set_lines(ph_by_idx(s, 14).text_frame,
              ["Модульный монолит: 17 доменных модулей, общий createApp() и одна SQLite в томе.",
               "",
               "Фронтенд — серверные страницы и статический JS без SPA-фреймворка: демо "
               "воспроизводится одной командой docker compose up.",
               "",
               "Каждое изменение проверяется скриптами: unit-тесты, процедура валидации "
               "и сквозной функциональный аудит."],
              size=13, color=INK, space_after=8)
    arch = [
        "auth · candidates · employers — регистрация, профили, роли",
        "assessment + tasks — батарея, формы A/B, cutoff, телеметрия",
        "matching · deck — категория → подборка → решения работодателя",
        "invitations — вилка ЗП, статусы, раскрытие контактов по accept",
        "calls · employer-tests · mcp — записи, короткие тесты, ИИ-клиенты",
    ]
    for i, idx in enumerate([15, 16, 17, 18, 19]):
        set_lines(ph_by_idx(s, idx).text_frame, [arch[i]], size=12, color=INK)

    # ---------- 15. Валидация: график + 3 KPI ----------
    s = slides[14]
    set_pill_title(s, "Валидация теста", size=15)
    cutoffs = metrics.get("cutoffs", {"junior": 0.55, "middle": 0.68, "senior": 0.78})
    strong = metrics.get("answerQuality", {}).get("strong", 0.734)
    weak = metrics.get("answerQuality", {}).get("weak", 0.0)
    delta = metrics.get("formEquivalence", {}).get("delta", 0.0)
    chart = next(sh.chart for sh in s.shapes if sh.has_chart)
    data = CategoryChartData()
    data.categories = ["Сильные ответы", "Слабые ответы", "Cutoff junior", "Cutoff middle", "Cutoff senior"]
    data.add_series("test_score", (strong, weak, cutoffs["junior"], cutoffs["middle"], cutoffs["senior"]))
    chart.replace_data(data)
    set_lines(ph_by_idx(s, 21).text_frame, ["Порог подтверждения категории"], size=14, bold=True, color=BRAND)
    set_lines(ph_by_idx(s, 18).text_frame,
              [f"Сильные ответы {strong:.2f} проходят cutoff middle {cutoffs['middle']}, "
               f"слабые {weak:.2f} — нет."],
              size=12, color=INK)
    set_lines(ph_by_idx(s, 22).text_frame, ["Эквивалентность форм"], size=14, bold=True, color=BRAND)
    set_lines(ph_by_idx(s, 23).text_frame,
              [f"A и B на одинаковых ответах дают Δ = {delta:.2f} при пороге 0.15."],
              size=12, color=INK)
    set_lines(ph_by_idx(s, 24).text_frame, ["Устойчивость к утечкам"], size=14, bold=True, color=BRAND)
    set_lines(ph_by_idx(s, 25).text_frame,
              ["9 из 9 ячеек выдали обе формы за 6 выдач — задания не повторяются подряд."],
              size=12, color=INK)

    # ---------- 16. Автоматическая проверка ----------
    s = slides[15]
    set_pill_title(s, "Что проверяется автоматически", size=13)
    chart2 = next(sh.chart for sh in s.shapes if sh.has_chart)
    data2 = CategoryChartData()
    data2.categories = ["Регистрация", "Тест и категория", "Приватность", "Потребность",
                        "Подбор и приглашения", "Доп. функционал"]
    data2.add_series("Проверок", (7, 7, 2, 3, 13, 9))
    chart2.replace_data(data2)
    auto_points = [
        ("Функциональный аудит", "41 проверка на стенде: регистрация → батарея → категория → подборка → приглашение → контакты"),
        ("Прод-режим", "8 читающих проверок на развёрнутом стенде без записи в базу"),
        ("Качество теста", "cutoff-тесты, эквивалентность форм, устойчивость к утечкам, отсутствие утечки баллов"),
        ("Приватность", "Контакты скрыты до accept, согласия обязательны, токены ИИ-клиентов изолированы от REST"),
    ]
    heads, subs = [21, 23, 25, 27], [22, 24, 26, None]
    for i, (title, body) in enumerate(auto_points):
        set_lines(ph_by_idx(s, heads[i]).text_frame, [title], size=13, bold=True, color=BRAND)
        if subs[i] is not None:
            set_lines(ph_by_idx(s, subs[i]).text_frame, [body], size=11, color=INK)

    # ---------- 17. Покрытие ТЗ ----------
    s = slides[16]
    set_pill_title(s, "Покрытие ТЗ", size=15)
    chart3 = next(sh.chart for sh in s.shapes if sh.has_chart)
    data3 = CategoryChartData()
    data3.categories = ["Реализовано и проверено", "Желательно (не блокер)", "Вне кода — концепция"]
    data3.add_series("Пункты", (40, 2, 3))
    chart3.replace_data(data3)
    coverage = [
        ("Механика подбора", "need → match → invite → accept → раскрытие контактов — 10 из 10 пунктов"),
        ("Тест и категории", "опрос, формы, cutoff, кулдаун, пересдача — 8 из 8 пунктов"),
        ("Не блокер MVP", "вакансии с откликом и разбор PDF-резюме — честно не сделаны"),
        ("Вне кода", "антифрод и ATS-интеграции описаны как концепция в документации"),
    ]
    heads, subs = [21, 23, 25, 27], [22, 24, 26, None]
    for i, (title, body) in enumerate(coverage):
        set_lines(ph_by_idx(s, heads[i]).text_frame, [title], size=13, bold=True, color=BRAND)
        if subs[i] is not None:
            set_lines(ph_by_idx(s, subs[i]).text_frame, [body], size=11, color=INK)

    # ---------- 18. Итог ----------
    s = slides[17]
    set_pill_title(s, "Итог", size=15)
    finals = [
        ("Что работает", "Категория по тесту, инициатива работодателя, контакты только по согласию. "
                         "41 автопроверка и читающий аудит на проде."),
        ("Честные ограничения", "Вакансии и PDF-разбор не сделаны — это «желательно» в ТЗ. "
                                "Реестр ФСП не имеет открытого API, предусмотрен кейс без истории ФСП."),
        ("Демо и код", "Прототип: handcheck.baski.pro · код: github.com/BaskovKonstantin/handcheck · "
                      "документация и аудит — в репозитории"),
    ]
    for i, idx in enumerate([26, 31, 32]):
        set_lines(ph_by_idx(s, idx).text_frame, [finals[i][0], "", finals[i][1]], size=14, color=INK)

    prs.save(OUT)
    print(f"Сохранено: {OUT} ({len(prs.slides._sldIdLst)} слайдов)")


if __name__ == "__main__":
    main()