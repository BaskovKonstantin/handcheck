#!/usr/bin/env python3
"""Короткая публичная презентация HandCheck.

Структура следует требованиям организаторов ФСП-2026:
  * слайды 7–11 официального шаблона — обязательные, сохраняются в исходном
    дизайне и структуре (меняется только текст и лишние карточки команды);
  * слайды после 11-го — рекомендательная зона, полная свобода творчества:
    здесь слайды собраны вручную в бренде HandCheck поверх фиолетового фона
    шаблона (как в образце BuildWatch).

Хелперы переиспользуются из scripts/build-jury-deck.py, чтобы не держать
вторую копию логики сборки.

Вход:  docs/presentation/template-fsp-2026.pptx
       handcheck-ui/presentation/*.png
       context/metrics-assessment.json

Выход: docs/presentation/HandCheck-overview.pptx  (+ .pdf + копии в downloads)

Запуск (из корня репозитория):
    ~/.venvs/pptx/bin/python scripts/build-overview-deck.py
"""

import importlib.util
import json
import os
import shutil
import subprocess
import sys

from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Emu, Inches, Pt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _load_jury_helpers():
    """Подключить хелперы сборщика жюри-деки как модуль."""
    path = os.path.join(ROOT, "scripts", "build-jury-deck.py")
    spec = importlib.util.spec_from_file_location("jury_deck", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


jury = _load_jury_helpers()

set_lines = jury.set_lines
ph_by_idx = jury.ph_by_idx
place_image = jury.place_image
add_notes = jury.add_notes
renumber = jury.renumber
drop_placeholder = jury.drop_placeholder
delete_slides = jury.delete_slides
strip_layout_sample_text = jury.strip_layout_sample_text
_rename_slide_part = jury._rename_slide_part
rgb = jury.rgb
BRAND = jury.BRAND          # 520978 — фиолетовый ФСП
ACCENT = jury.ACCENT        # FF0053 — акцент
INK = jury.INK              # 1C1D22

SHOTS = jury.SHOTS
ASSETS = jury.ASSETS
METRICS = jury.METRICS
TEMPLATE = jury.TEMPLATE
TEAM = jury.TEAM
CITY = jury.CITY
OUT = os.path.join(ROOT, "docs", "presentation", "HandCheck-overview.pptx")

WHITE = rgb("FFFFFF")
CARD_LINE = rgb("E6E1F2")
MUTED = rgb("5C6B7F")
CHROME = rgb("CFC8DC")       # подписи на фиолетовом фоне
TEAL = rgb("0D9488")

# Геометрия фирменного слайда (слайд 13.333 × 7.5 дюйма)
M = 0.55                    # боковое поле
TITLE_TOP = 0.72
BODY_TOP = 1.62
BODY_BOTTOM = 6.62
FOOTER_TOP = 6.92


# ---------------------------------------------------------------- хелперы

def load_team_module():
    """scripts/fill-team-info.py — общий источник данных команды для обеих деκ."""
    path = os.path.join(ROOT, "scripts", "fill-team-info.py")
    try:
        spec = importlib.util.spec_from_file_location("fill_team_info", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    except Exception as exc:  # noqa: BLE001 — дека собирается и без него
        print(f"WARN: данные команды не подставлены ({exc}); останутся поля шаблона")
        return None


def banner_team(team):
    """Данные команды в схеме, которую ждёт сборщик жюри-деки."""
    if team is None:
        return TEAM
    return [{"name": f"{m['first']} {m['last']}", "role": m["role"],
             "nick": m["telegram"], "phone": m["phone"], "place": m["work"],
             "about": f"{m['telegram']} · {m['phone']}"} for m in team.TEAM]


def apply_team_data(prs, team):
    """Подставить реальные данные команды в обязательные слайды 7–11."""
    if team is None:
        return
    for fn in (team.fill_about, team.fill_team_slide, team.fill_history,
               team.add_team_line_on_title):
        print(f"  {fn(prs)}")


def blank(prs):
    """Макет с фиолетовым фоном шаблона и без плейсхолдеров контента."""
    for name in ("Пустой", "Пустой с заголовком"):
        for layout in prs.slide_layouts:
            if layout.name == name:
                return layout
    raise SystemExit("В шаблоне нет пустого макета")


def brand_slide(prs, header, title, page, notes=None):
    """Новый слайд в бренде: шапка капсом, заголовок, подвал и номер.

    Макет «Пустой с заголовком» наследует фиолетовый фон шаблона с логотипами
    постановщика, клонированные плейсхолдеры удаляются — рисуем всё сами.
    """
    layout = blank(prs)
    slide = prs.slides.add_slide(layout)
    _rename_slide_part(prs, slide)
    for shape in list(slide.shapes):
        if shape.is_placeholder:
            shape._element.getparent().remove(shape._element)

    cap = slide.shapes.add_textbox(Inches(M), Inches(0.34), Inches(8.0), Inches(0.3))
    set_lines(cap.text_frame, [header.upper()], size=10, bold=True, color=CHROME)
    for run in cap.text_frame.paragraphs[0].runs:
        run.font._rPr.set("spc", "160")

    head = slide.shapes.add_textbox(Inches(M), Inches(TITLE_TOP), Inches(12.2), Inches(0.7))
    set_lines(head.text_frame, [title], size=27, bold=True, color=WHITE)

    foot = slide.shapes.add_textbox(Inches(M), Inches(FOOTER_TOP), Inches(7.0), Inches(0.26))
    set_lines(foot.text_frame, ["HANDCHECK • ФСП 2026"], size=9, color=CHROME)

    num = slide.shapes.add_textbox(Inches(11.9), Inches(FOOTER_TOP), Inches(0.85), Inches(0.26))
    set_lines(num.text_frame, [f"{page:02d}"], size=9, color=CHROME, align=PP_ALIGN.RIGHT)

    if notes:
        add_notes(slide, notes)
    return slide


def no_bullet(para):
    """Убрать маркер списка — карточки набираются обычными абзацами."""
    from pptx.oxml.ns import qn

    p_pr = para._p.get_or_add_pPr()
    p_pr.append(p_pr.makeelement(qn("a:buNone"), {}))


def body_card(slide, left, top, width, height, title, lines, **kw):
    """Белая карточка: заголовок фиолетовым, ниже — строки обычным текстом."""
    shape = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE, Inches(left), Inches(top), Inches(width), Inches(height))
    shape.fill.solid()
    shape.fill.fore_color.rgb = WHITE
    shape.line.color.rgb = CARD_LINE
    shape.line.width = Pt(0.75)
    shape.shadow.inherit = False
    shape.adjustments[0] = 0.05

    frame = shape.text_frame
    frame.word_wrap = True
    frame.vertical_anchor = MSO_ANCHOR.TOP
    frame.margin_left = Inches(0.26)
    frame.margin_right = Inches(0.22)
    frame.margin_top = Inches(0.2)
    frame.margin_bottom = Inches(0.16)
    frame.clear()
    set_lines(frame, [title], size=kw.get("title_size", 13), bold=True,
              color=kw.get("title_color", BRAND), space_after=kw.get("space_after", 7),
              align=PP_ALIGN.LEFT)
    for line in lines:
        para = frame.add_paragraph()
        para.space_after = Pt(kw.get("space_after", 7))
        para.text = line
        for run in para.runs:
            run.font.size = Pt(kw.get("body_size", 11))
            run.font.name = "Manrope"
            run.font.color.rgb = kw.get("body_color", INK)
        no_bullet(para)
    return shape


def numbered_card(slide, left, top, width, height, number, title, text,
                  title_size=12, body_size=10.5):
    """Карточка шага сценария: номер в заголовке, пояснение под ним."""
    return body_card(slide, left, top, width, height, f"{number} · {title}", [text],
                     title_size=title_size, body_size=body_size, space_after=4)


def stat_card(slide, left, top, width, height, value, label, value_color=BRAND):
    """Крупное число с подписью."""
    shape = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE, Inches(left), Inches(top), Inches(width), Inches(height))
    shape.fill.solid()
    shape.fill.fore_color.rgb = WHITE
    shape.line.color.rgb = CARD_LINE
    shape.line.width = Pt(0.75)
    shape.shadow.inherit = False
    shape.adjustments[0] = 0.09
    frame = shape.text_frame
    frame.word_wrap = True
    frame.vertical_anchor = MSO_ANCHOR.MIDDLE
    frame.margin_top = Inches(0.16)
    frame.margin_bottom = Inches(0.12)
    frame.clear()
    set_lines(frame, [value], size=26, bold=True, color=value_color,
              align=PP_ALIGN.CENTER, space_after=2)
    para = frame.add_paragraph()
    para.text = label
    para.alignment = PP_ALIGN.CENTER
    for run in para.runs:
        run.font.size = Pt(10)
        run.font.name = "Manrope"
        run.font.color.rgb = MUTED
    return shape


def shot_card(slide, left, top, width, height, shot, label, caption_text,
              label_color=BRAND):
    """Скриншот кабинета в белой карточке с подписью «Основная идея»."""
    box = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE, Inches(left), Inches(top), Inches(width), Inches(height))
    box.fill.solid()
    box.fill.fore_color.rgb = WHITE
    box.line.color.rgb = CARD_LINE
    box.line.width = Pt(0.75)
    box.shadow.inherit = False
    box.adjustments[0] = 0.04

    pad = 0.22
    cap_h = 1.18
    place_image(slide, os.path.join(SHOTS, shot),
                (left + pad, top + pad, width - 2 * pad, height - cap_h - 1.4 * pad))

    tag = slide.shapes.add_textbox(Inches(left + pad), Inches(top + height - cap_h + 0.06),
                                   Inches(width - 2 * pad), Inches(0.24))
    set_lines(tag.text_frame, [label.upper()], size=9, bold=True, color=label_color)

    text = slide.shapes.add_textbox(Inches(left + pad), Inches(top + height - cap_h + 0.32),
                                    Inches(width - 2 * pad), Inches(0.8))
    set_lines(text.text_frame, [caption_text], size=10.5, color=INK)
    return box


# ---------------------------------------------------------------- сборка

def main():
    if not os.path.exists(TEMPLATE):
        sys.exit(f"Нет шаблона: {TEMPLATE}")
    metrics = {}
    if os.path.exists(METRICS):
        metrics = json.load(open(METRICS))

    team = load_team_module()

    prs = Presentation(TEMPLATE)
    strip_layout_sample_text(prs)

    # Оставляем только обязательный блок шаблона: слайды 7–11 (1-based).
    # Остальное удаляем до добавления своих слайдов — delete_slides(prs, keep)
    # оставляет ровно индексы из keep.
    delete_slides(prs, {6, 7, 8, 9, 10})
    slides = list(prs.slides)

    # ---------- 1. Титульный (слайд 7 шаблона, обязательный) ----------
    s = slides[0]
    set_lines(ph_by_idx(s, 0).text_frame, ["HandCheck"], size=44, bold=True, color=WHITE)
    set_lines(ph_by_idx(s, 12).text_frame,
              ["Категорию даёт тест. Приглашение даёт работодатель. "
               "Контакты — только согласие."],
              size=14, color=rgb("EDE9FE"))
    add_notes(s, "HandCheck: коротко о продукте. Категорию даёт тест, приглашение даёт "
                 "работодатель, контакты — только согласие обеих сторон.")

    # ---------- 2. О команде: описание и уникальность (слайд 8) ----------
    s = slides[1]
    set_lines(ph_by_idx(s, 0).text_frame, ["Категорию даёт батарея"], size=22, bold=True,
              color=BRAND)
    photo = ph_by_idx(s, 10)
    if photo is not None:
        box = (Emu(photo.left).inches, Emu(photo.top).inches,
               Emu(photo.width).inches, Emu(photo.height).inches)
        photo._element.getparent().remove(photo._element)
        banner_path = jury.team_banner_png(banner_team(team),
                                            os.path.join(ASSETS, "team-banner.png"))
        place_image(s, banner_path, box, crop_fill=False)
    captain = TEAM[0]
    jury.set_shape_lines(jury.shape_by_text(s, "Капитан: ФИО"),
                         [f"Капитан: {captain['name']}",
                          f"Кол-во участников: {len(TEAM)}",
                          f"Краткое описание: {captain['place']}",
                          f"Город и регион: {CITY}"], size=12, color=INK)
    jury.set_shape_lines(jury.shape_by_text(s, "В чем суть вашего решения"),
                         ["Кандидат проходит опрос и батарею — получает категорию "
                          "«специализация × грейд». Работодатель ищет по категории и сам "
                          "зовёт с вилкой ЗП. Контакты открываются только после согласия."],
                         size=12, color=INK)
    jury.set_shape_lines(jury.shape_by_text(s, "Что делает ваше решение уникальным"),
                         ["Это не доска вакансий: категорию ставит только пройденная батарея, "
                          "а устойчивость параллельных форм A/B измерена, а не заявлена."],
                         size=12, color=INK)
    add_notes(s, "Главное: мы продаём не вакансии, а проверенных людей. Уникальность — "
                 "категория только после теста плюс измеренная устойчивость форм.")

    # ---------- 3. Состав команды (слайд 9) ----------
    s = slides[2]
    jury.set_pill_title(s, "Команда", size=15)
    jury.fill_team_slide(s)
    add_notes(s, "Правила ФСП разрешают удалить лишние карточки, если участник один. "
                 "Перед сдачей вписать ник, телефон и город.")

    # ---------- 4. Краткая история команды (слайд 10) ----------
    s = slides[3]
    jury.set_pill_title(s, "Краткая история команды", size=15)
    set_lines(ph_by_idx(s, 27).text_frame,
              ["Рекрут по резюме плохо работает: список одинаковый для всех, а качество "
               "приходится проверять вручную дорогими специалистами."],
              size=12, color=INK)
    jury.set_shape_lines(jury.shape_by_text(s, "Что вас вдохновило"),
                         ["Самая сложная часть — устойчивость теста. Отказались от генерации "
                          "заданий под каждого кандидата: банк с двумя параллельными формами, "
                          "серверный дедлайн и кулдаун на смену категории."], size=12, color=INK)
    jury.set_shape_lines(jury.shape_by_text(s, "Расскажите о самых интересных"),
                         ["Каждое изменение проверялось автоматически: node --test, "
                          "процедуры валидации теста, подбора и приватности плюс сквозной "
                          "аудит из 41 проверки."], size=12, color=INK)
    add_notes(s, "История короткая: один разработчик, один кейс из практики, одна "
                 "главная инженерная проблема — утечки в тесте.")

    # ---------- 5. Коротко о решении (слайд 11) ----------
    s = slides[4]
    set_lines(ph_by_idx(s, 38).text_frame,
              ["Node.js 20 + Express + SQLite, 17 доменных модулей; UI без SPA-фреймворка",
               "Банк из 162 заданий: 9 батарей (backend / frontend / QA × junior / middle / senior)",
               "Серверные дедлайны, черновики, телеметрия попыток, cutoff 0.55 / 0.68 / 0.78",
               "Подбор: категория → rank = 0.60·тест + 0.15·мотивация + 0.10·ФСП + 0.15·домен",
               "MCP-сервер /mcp: ИИ-клиенты читают и меняют данные платформы"],
              size=13, color=INK, bullet=True)
    set_lines(ph_by_idx(s, 42).text_frame,
              ["Рекрутер перестаёт разбирать сотни анкет: получает готовую категорию с обоснованием",
               "Кандидат не откликается вслепую — инициатива у работодателя",
               "Участники соревновательного движения конвертируют навыки в оффер, а не в строчку резюме",
               "Контакты скрыты до accept: меньше спама, выше вовлечённость обеих сторон"],
              size=13, color=INK, bullet=True)
    add_notes(s, "Техническая суть — архитектура и честность замера. Маркетинговая — "
                 "выгода для обеих сторон и отсутствие сливов.")

    # ---------- 6. Концепция и архитектура ----------
    s = brand_slide(
        prs, "Концепция и архитектура", "Концепция и архитектура", 6,
        "Слева — продуктовая идея, справа — путь данных от опроса до согласия. "
        "Ниже — контур решения.")
    body_card(s, M, BODY_TOP, 6.1, 4.36, "Концепция", [
        "Тест вместо резюме. Категория = специализация × грейд, ставится только "
        "после батареи.",
        "Банк заданий. 162 задания в 9 батареях, обе формы A/B в каждой ячейке.",
        "Честная валидация. Δ оценок форм A/B = 0.00 при пороге 0.15; сильный "
        "ответ 0.734, слабый 0.000.",
        "Подбор по категории. Потребность → подборка с объяснением; фильтры только "
        "сужают выдачу.",
        "Приватность по умолчанию. Контакты скрыты до согласия обеих сторон.",
    ], body_size=11.5, space_after=9)
    body_card(s, 6.88, BODY_TOP, 5.9, 4.36, "Архитектура", [
        "01 · Опрос и категория — специализация, заявленный грейд, согласие на "
        "обработку данных.",
        "02 · Батарея — 8 быстрых заданий и мини-проект, дедлайн, черновик, телеметрия.",
        "03 · Подбор и приглашение — потребность работодателя → категория → колода → "
        "вилка ЗП.",
        "04 · Согласие — контакты открываются только после accept.",
    ], body_size=11.5, space_after=9)
    strip = body_card(s, M, 6.12, 12.23, 0.52, "", [], body_size=10)
    set_lines(strip.text_frame,
              ["Модульный монолит: 17 доменов · SQLite в одном volume · сборка "
               "контейнера и деплой одной командой"],
              size=10.5, bold=True, color=BRAND, align=PP_ALIGN.CENTER)

    # ---------- 7. Технологии ----------
    s = brand_slide(
        prs, "Технологии", "Технологии и эксплуатация", 7,
        "Стек без экзотики: всё, что нужно для честного теста и предсказуемого "
        "прод-окружения.")
    stack = body_card(s, M, BODY_TOP, 12.23, 0.62, "", [], body_size=10)
    set_lines(stack.text_frame,
              ["Node.js 20 · Express · SQLite (better-sqlite3, WAL) · WebSocket · "
               "MCP SDK · Zod · Docker Compose · Caddy · GitHub Actions · OpenAPI · "
               "Playwright"],
              size=11.5, bold=True, color=BRAND, align=PP_ALIGN.CENTER)
    w3 = (12.23 - 2 * 0.23) / 3
    body_card(s, M, 2.44, w3, 4.2, "Бэкенд и данные", [
        "Модульный монолит: 17 доменных модулей, общий createApp() и тонкий "
        "bootstrap.",
        "SQLite в одном volume, сессии в БД, журнал шагов теста.",
        "WebSocket-сигналинг звонков, запись и авто-сводка разговора.",
        "MCP-сервер /mcp: персональные токены hc_ и области read/write.",
        "Zod-схемы на входе API, контракт описан в openapi.yaml.",
    ], body_size=10.5, space_after=8)
    body_card(s, M + w3 + 0.23, 2.44, w3, 4.2, "Продукт и интерфейс", [
        "Серверные страницы без SPA-фреймворка: быстрый старт и честный вес UI.",
        "13 экранов двух кабинетов: кандидат и работодатель.",
        "Шрифты Manrope и Onest, тёмные кабинеты, мобильная вёрстка от 390 px.",
        "Демо-вход для показа без регистрации.",
        "LLM только на черновиках и сводках — оценку ставит банк заданий.",
    ], body_size=10.5, space_after=8)
    body_card(s, M + 2 * (w3 + 0.23), 2.44, w3, 4.2, "Инфраструктура и контроль", [
        "Docker Compose и Caddy на handcheck.baski.pro, секреты вне git.",
        "Деплой из main через self-hosted runner с проверкой коммита.",
        "node --test для регрессий: сценарии теста, приглашений и записи звонка.",
        "npm run validate: качество теста, честность подбора и приватность.",
        "Скриптовый аудит функций — 41 проверка без сети.",
    ], body_size=10.5, space_after=8)

    # ---------- 8. Пример работы. Работодатель ----------
    s = brand_slide(
        prs, "Пример работы", "Пример работы. Кабинет работодателя", 8,
        "Слева колода решений, справа подборка по категории. Оба экрана — "
        "рабочий путь, а не витрина.")
    shot_card(s, M, BODY_TOP, 6.1, 4.36, "02-employer-deck.png", "Основная идея",
              "Колода кандидатов: решение в один тап — принять с вилкой ЗП, отложить "
              "или отказаться. Повторное приглашение после отказа блокируется.")
    shot_card(s, 6.88, BODY_TOP, 5.9, 4.36, "04-employer-candidates.png", "Основная идея",
              "Подборка по категории «backend × middle»: стек, участие в ФСП, поиск и "
              "статус сужают выдачу, но не подменяют её.")

    # ---------- 9. Пример работы. Кандидат ----------
    s = brand_slide(
        prs, "Пример работы", "Пример работы. Кабинет кандидата", 9,
        "Кандидат видит прогресс по батарее и приглашения с вилкой. Контакты "
        "работодателя появляются только после согласия.")
    shot_card(s, M, BODY_TOP, 6.1, 4.36, "08-candidate-today.png", "Основная идея",
              "Сегодня: прогресс по батарее, подтверждённая категория и активные "
              "приглашения — без резюме и без публичного профиля.")
    shot_card(s, 6.88, BODY_TOP, 5.9, 4.36, "09-candidate-invitations.png", "Основная идея",
              "Приглашение: вилка ЗП, понятный статус и ответ в один тап. Телефон и "
              "почта открываются только после согласия.")

    # ---------- 10. Как это работает ----------
    s = brand_slide(
        prs, "Сценарий", "Как это работает", 10,
        "Шесть шагов от регистрации до приглашения. Категория появляется только "
        "на третьем шаге и только из результатов теста.")
    steps = [
        ("01", "Опрос кандидата", "Специализация и заявленный грейд, согласие на обработку данных."),
        ("02", "Старт батареи", "8 быстрых заданий и мини-проект, форма A или B на выбор сервера."),
        ("03", "Честный замер", "Серверный дедлайн, черновик ответов и телеметрия каждого шага."),
        ("04", "Cutoff по грейду", "junior 0.55 · middle 0.68 · senior 0.78 — порог подтверждения навыка."),
        ("05", "Категория", "Специализация × грейд, cooldown 30 дней на смену, понижение только пересдачей."),
        ("06", "Приглашение", "Работодатель зовёт с вилкой ЗП, контакты — после согласия обеих сторон."),
    ]
    w3 = (12.23 - 2 * 0.23) / 3
    h3 = 1.86
    for i, (num, title, text) in enumerate(steps):
        col, row = i % 3, i // 3
        numbered_card(s, M + col * (w3 + 0.23), BODY_TOP + row * (h3 + 0.24), w3, h3,
                      num, title, text)
    strip = body_card(s, M, 6.12, 12.23, 0.52, "", [], body_size=10)
    set_lines(strip.text_frame,
              ["Пока батарея не пройдена, подборка у работодателя пустая — это и есть "
               "механика, а не фильтр поверх анкет"],
              size=10.5, bold=True, color=BRAND, align=PP_ALIGN.CENTER)

    # ---------- 11. Приватность как механика ----------
    s = brand_slide(
        prs, "Приватность", "Приватность как механика, а не как обещание", 11,
        "Каждый пункт закрыт проверкой в автотестах и скриптовом аудите: это "
        "поведение API, а не текст политики.")
    privacy = [
        ("Согласие 152-ФЗ", "Отдельное согласие на обработку данных фиксируется до старта теста."),
        ("Разделение ролей", "Кандидат и работодатель видят только свои сущности и чужие ответы — нет."),
        ("Контакты скрыты", "До согласия доступ к контактам даёт 403, в JSON приглашения нет телефона и почты."),
        ("Раскрытие по согласию", "Контакты появляются после accept и только у двух сторон переписки."),
        ("Второй кандидат", "Работодатель не видит контакты других кандидатов из той же подборки."),
        ("Токены ИИ-клиентов", "Персональный токен с областью read/write; доступ изолирован от REST-сессии."),
    ]
    w3 = (12.23 - 2 * 0.23) / 3
    h3 = 2.0
    for i, (title, text) in enumerate(privacy):
        col, row = i % 3, i // 3
        card = body_card(s, M + col * (w3 + 0.23), BODY_TOP + row * (h3 + 0.24), w3, h3,
                         title, [text], body_size=10.5, space_after=0)
        card.text_frame.margin_right = Inches(0.56)
        badge = s.shapes.add_shape(MSO_SHAPE.OVAL,
                                   Inches(M + col * (w3 + 0.23) + w3 - 0.56),
                                   Inches(BODY_TOP + row * (h3 + 0.24) + 0.2),
                                   Inches(0.3), Inches(0.3))
        badge.fill.solid()
        badge.fill.fore_color.rgb = TEAL
        badge.line.fill.background()
        badge.shadow.inherit = False
        set_lines(badge.text_frame, ["✓"], size=11, bold=True, color=WHITE,
                  align=PP_ALIGN.CENTER)

    # ---------- 12. Тест: как доказали качество ----------
    s = brand_slide(
        prs, "Валидация", "Тест: чем доказано качество", 12,
        "Числа из повторяемого прогона assessment-metrics.js, а не из презентации. "
        "Порог эквивалентности форм — 0.15.")
    stats = [
        (str(metrics.get("totalPublishedTasks", 162)), "опубликованных заданий в банке"),
        ("9 / 9", "батарей содержат обе формы A и B"),
        ("0.00", "Δ оценок форм A/B при пороге 0.15"),
        ("0.734", "сильный ответ подтверждён"),
        ("0.000", "слабый ответ не подтверждён"),
    ]
    w5 = (12.23 - 4 * 0.2) / 5
    for i, (value, label) in enumerate(stats):
        stat_card(s, M + i * (w5 + 0.2), BODY_TOP, w5, 1.75, value, label)
    body_card(s, M, 3.62, 12.23, 1.06, "Как мерили", [
        "Шесть выдач в каждой из девяти ячеек: в каждой встретились обе формы. Регрессии "
        "ловят validate:assessment и validate:privacy, сквозной функциональный аудит "
        "даёт 41 проверку без сети.",
    ], body_size=11)
    body_card(s, M, 4.9, 12.23, 1.05, "Почему это важно продукту", [
        "Банк заданий и параллельные формы дают категорию, которую нельзя переучить "
        "за вечер и нельзя «утечь» из прошлой сессии. Cutoff по грейду не даёт занизить "
        "сильного кандидата и не даёт провести слабого.",
    ], body_size=11)

    # ---------- 13. Итог и развитие ----------
    s = brand_slide(
        prs, "Итог", "Итог, ограничения и развитие", 13,
        "Финал: что уже работает, что честно не сделано и куда смотреть.")
    w3 = (12.23 - 2 * 0.23) / 3
    body_card(s, M, BODY_TOP, w3, 4.3, "Что работает сегодня", [
        "Подбор по категории: потребность → кандидаты с объяснением.",
        "Категория только после теста, честная валидация форм A/B.",
        "Приватность до согласия: контакты скрыты технически, а не только в тексте.",
        "MCP-сервер: ИИ-клиенты работают с платформой без кода.",
        "Живой прод на handcheck.baski.pro, деплой из main.",
    ], body_size=10.5, space_after=8)
    body_card(s, M + w3 + 0.23, BODY_TOP, w3, 4.3, "Честные ограничения", [
        "Один участник команды и один банк заданий на 9 ячеек.",
        "Нет автогенерации PDF-профиля кандидата и периодических заданий.",
        "Сетевой адаптер реестра ФСП описан как концепция, не как код.",
        "OCR и импорт резюме сознательно не делаем.",
        "Мобильная вёрстка проверена на 390 px, не на всём парке устройств.",
    ], body_size=10.5, space_after=8)
    body_card(s, M + 2 * (w3 + 0.23), BODY_TOP, w3, 4.3, "Куда развиваем", [
        "Сетевой адаптер ФСП и верифицированный профиль достижений.",
        "Короткие поддерживающие задания между батареями.",
        "Автогенерация PDF-профиля кандидата с подтверждённой категорией.",
        "Вакансии как необязательное расширение поверх потребности.",
        "Расширение банка за пределы backend, frontend и QA.",
    ], body_size=10.5, space_after=8)
    box = body_card(s, M, 6.1, 12.23, 0.52, "", [], body_size=10)
    set_lines(box.text_frame,
              ["handcheck.baski.pro · исходный код, документация и эта презентация — "
               "в приложении к проекту и в /downloads"],
              size=10.5, bold=True, color=BRAND, align=PP_ALIGN.CENTER)

    # ---------- обязательные слайды шаблона остаются в исходном дизайне ----------
    for number, slide in enumerate(list(prs.slides)[:5], 1):
        renumber(slide, number)

    apply_team_data(prs, team)
    prs.save(OUT)
    print(f"Сохранено: {OUT}")
    export_pdf_and_publish()


def export_pdf_and_publish():
    outdir = os.path.dirname(OUT)
    subprocess.run(["soffice", "--headless", "--convert-to", "pdf",
                    "--outdir", outdir, OUT],
                   check=False, stdout=subprocess.DEVNULL,
                   stderr=subprocess.DEVNULL, timeout=900)
    pdf = os.path.splitext(OUT)[0] + ".pdf"
    print(f"Сохранено: {pdf}" if os.path.exists(pdf) else "PDF не собрался")

    downloads = os.path.join(ROOT, "app", "public", "downloads")
    if not os.path.isdir(downloads):
        return
    for src, name in ((OUT, "HandCheck-overview.pptx"), (pdf, "HandCheck-overview.pdf")):
        if os.path.exists(src):
            shutil.copyfile(src, os.path.join(downloads, name))
            print(f"Опубликовано: downloads/{name}")


if __name__ == "__main__":
    main()