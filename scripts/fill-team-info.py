#!/usr/bin/env python3
"""Заполнить в презентации ФСП данные команды «БАС».

    python3 scripts/fill-team-info.py

Правит готовый docs/presentation/HandCheck-ФСП-2026.pptx на месте:
  • слайд 2 «О команде» — капитан, состав, описание, город;
  • слайд 3 «Команда» — две карточки участников (капитан и продуктовый менеджер);
  • слайд 4 «Краткая история» — блок 01 переписывается под нашу задачу;
  • титульный слайд — добавляется строка «Команда „БАС“ · Санкт-Петербург».

Скрипт идемпотентен: можно запускать повторно после любой пересборки дека.
Данные команды берутся из финальной презентации BuildWatch (ЛЦТ 2026), тот же состав.
"""

import copy
import os
import sys

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.util import Emu, Inches, Pt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DECK = os.path.join(ROOT, "docs", "presentation", "HandCheck-ФСП-2026.pptx")

INK = RGBColor.from_string("1C1D22")
BRAND = RGBColor.from_string("520978")
WHITE = RGBColor.from_string("FFFFFF")

TEAM = [
    {
        "first": "Константин",
        "last": "Басков",
        "role": "Разработчик, капитан",
        "telegram": "@KonstantBas",
        "phone": "+7 918 318-47-80",
        "work": "фриланс",
        "initial": "К",
    },
    {
        "first": "Дмитрий",
        "last": "Манаков",
        "role": "Продуктовый менеджер",
        "telegram": "@ddmanakov",
        "phone": "+7 960 000-15-17",
        "work": "фриланс",
        "initial": "Д",
    },
]

ABOUT = [
    "Капитан: Басков Константин, разработчик",
    "Кол-во участников: 2 человека",
    "Краткое описание: оба занимаемся разработкой ПО и внедрением инноваций;",
    "решили участвовать, потому что интересно поработать над комплексной системой.",
    "Город и регион: Санкт-Петербург",
]

HISTORY_01 = (
    "Вместе работаем над разными продуктами автоматизации: от мониторинга "
    "строительных площадок до систем подбора персонала. Оба понимаем, что в "
    "найме больше всего времени уходит на ручной отбор, поэтому захотели "
    "проверить идею на реальном коде."
)


def set_lines(tf, lines, size=None, bold=False, color=None, align=None, space_after=2):
    tf.clear()
    tf.word_wrap = True
    for i, line in enumerate(lines if isinstance(lines, (list, tuple)) else [lines]):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.text = line
        if align is not None:
            p.alignment = align
        p.space_after = Pt(space_after)
        for target in [p.font] + [r.font for r in p.runs]:
            if size:
                target.size = Pt(size)
            if bold:
                target.bold = True
            if color is not None:
                target.color.rgb = color
    return tf


def make_initial_avatar(path, letter):
    """Простая аватарка с инициалом в брендовых цветах."""
    from PIL import Image, ImageDraw, ImageFont

    size = 480
    img = Image.new("RGB", (size, size), "#520978")
    draw = ImageDraw.Draw(img)
    draw.ellipse((10, 10, size - 10, size - 10), fill="#6d3ba3")
    font = None
    for candidate in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        str(os.path.expanduser("~/.local/share/fonts/Montserrat-Variable.ttf")),
    ):
        if os.path.exists(candidate):
            try:
                font = ImageFont.truetype(candidate, 230)
                break
            except OSError:
                continue
    if font is None:
        font = ImageFont.load_default()
    text = letter.upper()
    bbox = draw.textbbox((0, 0), text, font=font)
    draw.text(((size - (bbox[2] - bbox[0])) / 2 - bbox[0], (size - (bbox[3] - bbox[1])) / 2 - bbox[1]),
              text, fill="#ffffff", font=font)
    img.save(path)
    return path


def shape_by_text(slide, needle):
    for sh in slide.shapes:
        if sh.has_text_frame and needle in sh.text_frame.text:
            return sh
    return None


def fill_about(prs):
    slide = list(prs.slides)[1]
    box = shape_by_text(slide, "Капитан:")
    if box is None:
        return "слайд «О команде»: блок не найден"
    set_lines(box.text_frame, ABOUT, size=11, color=INK)
    return "слайд 2: блок «О команде» заполнен"


def fill_history(prs):
    slide = list(prs.slides)[3]
    ph = None
    for shape in slide.placeholders:
        if shape.placeholder_format.idx == 27:
            ph = shape
    if ph is None:
        return "слайд «История»: плейсхолдер не найден"
    set_lines(ph.text_frame, [HISTORY_01], size=11, color=INK)
    return "слайд 4: блок 01 переписан под нашу задачу"


def fill_team_slide(prs):
    slide = list(prs.slides)[2]
    rects = [sh for sh in slide.shapes
             if not sh.is_placeholder and sh.shape_type == 1
             and Emu(sh.width).inches > 2 and Emu(sh.height).inches > 4]
    names = [sh for sh in slide.shapes if sh.has_text_frame and "Константин" in sh.text_frame.text]
    if not rects or not names:
        return "слайд «Команда»: карточка не найдена"
    rect = rects[0]
    name_box = names[0]
    detail = None
    for sh in slide.shapes:
        if sh.has_text_frame and "Роль:" in sh.text_frame.text:
            detail = sh
    picture = None
    for sh in slide.shapes:
        if sh.shape_type == 13:
            picture = sh

    slots = [4.05, 6.95]  # две карточки по центру слайда
    blocks = []
    for slot, member in zip(slots, TEAM):
        if member is TEAM[0]:
            blocks.append({"rect": rect, "name": name_box, "detail": detail, "pic": picture})
        else:
            new = {"pic": None}
            for key, src in (("rect", rect), ("name", name_box), ("detail", detail)):
                if src is None:
                    new[key] = None
                    continue
                el = copy.deepcopy(src._element)
                src._element.getparent().append(el)
                new[key] = None
                for sh in slide.shapes:
                    if sh._element is el:
                        new[key] = sh
                        break
            blocks.append(new)

    for block, member, slot in zip(blocks, TEAM, slots):
        if block["rect"] is not None:
            block["rect"].left = Inches(slot)
            block["rect"].top = Inches(1.7)
        if block["name"] is not None:
            block["name"].left = Inches(slot + 0.2)
            block["name"].top = Inches(4.0)
            set_lines(block["name"].text_frame, [f"{member['first']} {member['last']}"],
                      size=12, bold=True, color=BRAND)
        if block["detail"] is not None:
            block["detail"].left = Inches(slot + 0.2)
            block["detail"].top = Inches(4.6)
            set_lines(block["detail"].text_frame,
                      [f"Роль: {member['role']}",
                       f"Telegram: {member['telegram']}",
                       f"Тел.: {member['phone']}",
                       f"Место работы: {member['work']}"],
                      size=9, color=INK)
        if block["pic"] is not None:
            block["pic"].left = Inches(slot + 0.2)
            block["pic"].top = Inches(2.0)
            block["pic"].width = Inches(1.9)
            block["pic"].height = Inches(1.7)

    # аватарки: у капитана уже есть картинка, второму участнику делаем инициал
    avatar_dir = os.path.join(ROOT, "context", "presentation-assets")
    os.makedirs(avatar_dir, exist_ok=True)
    try:
        avatar = make_initial_avatar(os.path.join(avatar_dir, "avatar-1.png"), TEAM[1]["initial"])
        slide.shapes.add_picture(avatar, Inches(slots[1] + 0.2), Inches(2.0), Inches(1.9), Inches(1.7))
    except Exception as exc:  # noqa: BLE001
        print(f"WARN: аватарка второго участника не добавлена: {exc}")

    pill = shape_by_text(slide, "Команда")
    if pill is not None:
        set_lines(pill.text_frame, ["Команда «БАС»"], size=15, bold=True, color=WHITE)
    return "слайд 3: две карточки участников"


def add_team_line_on_title(prs):
    slide = list(prs.slides)[0]
    tag = shape_by_text(slide, "Категорию даёт тест")
    if tag is None:
        return "титульный слайд: подпись не найдена"
    lines = [tag.text_frame.paragraphs[0].text] + [
        p.text for p in tag.text_frame.paragraphs[1:] if p.text.strip()
    ]
    lines.append("Команда «БАС» · Санкт-Петербург")
    set_lines(tag.text_frame, lines, size=15, color=WHITE)
    return "титульный слайд: добавлена строка о команде"


def main():
    if not os.path.exists(DECK):
        sys.exit(f"Нет файла дека: {DECK}")
    prs = Presentation(DECK)
    for fn in (fill_about, fill_team_slide, fill_history, add_team_line_on_title):
        print(f"  {fn(prs)}")
    prs.save(DECK)
    print(f"Сохранено: {DECK}")


if __name__ == "__main__":
    main()