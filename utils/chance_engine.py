"""
utils/chance_engine.py
──────────────────────
Умный движок вероятностей для кейсов и рулетки.

Логика работы
─────────────
1. МЯГКОЕ ПИТИ (soft pity):
   Если игрок N раз подряд НЕ получал крупный приз (jackpot),
   шанс джекпота начинает плавно расти (+SOFT_PITY_BOOST за каждый спин
   сверх порога SOFT_PITY_START). Игрок реально может выбить что-то дорогое.

2. ЖЁСТКОЕ ПИТИ (hard pity):
   После HARD_PITY спинов без джекпота следующий ролл ГАРАНТИРОВАННО
   даёт джекпот (случайный из пула jackpot-предметов).

3. КУЛДАУН ПОСЛЕ ДЖЕКПОТА (cooldown):
   Сразу после крупного выигрыша устанавливается cooldown_count.
   Пока cooldown > 0, шанс джекпота снижен на COOLDOWN_PENALTY (70%).
   Таким образом «после крупного — не очень» работает ровно так, как задумано.

Что считается джекпотом
────────────────────────
Предмет является джекпотом, если его стоимость в звёздах ≥ cost * jackpot_threshold.
Порог по умолчанию — 3×. Например, в Broke Case (cost=15⭐) джекпот — это
приз стоимостью ≥ 45⭐; в Space Case (cost=150⭐) — ≥ 450⭐.

Настройки по умолчанию
──────────────────────
    SOFT_PITY_START  = 7   — мягкое пити начинается с 7-го подряд не-джекпота
    HARD_PITY        = 25  — 25-й спин без джекпота = гарантия
    SOFT_PITY_BOOST  = 0.25  — ×25% веса джекпот-предметов за каждый спин выше порога
    COOLDOWN_START   = 5   — 5 спинов кулдауна после джекпота
    COOLDOWN_PENALTY = 0.30  — шанс джекпота × 0.30 во время кулдауна (−70%)

Использование
─────────────
    from utils.chance_engine import roll_with_pity, is_jackpot, COOLDOWN_START

    # Роллим предмет
    win_item = roll_with_pity(
        items        = case["items"],
        get_value    = _get_item_value_stars,
        cost         = case["price"],
        pity_count   = user_pity,
        cooldown_count = user_cooldown,
    )

    # Определяем, был ли это джекпот, чтобы обновить счётчики в БД
    if is_jackpot(win_item, _get_item_value_stars, case["price"]):
        new_pity      = 0
        new_cooldown  = COOLDOWN_START
    else:
        new_pity      = user_pity + 1
        new_cooldown  = max(0, user_cooldown - 1)
"""

from __future__ import annotations

import random
from typing import Callable

# ── Параметры пити (можно переопределить при вызове) ─────────────────────────

SOFT_PITY_START  = 7     # спинов без джекпота до начала буста
HARD_PITY        = 25    # спинов без джекпота до гарантии
SOFT_PITY_BOOST  = 0.25  # +25% веса джекпота за каждый спин сверх SOFT_PITY_START
COOLDOWN_START   = 5     # спинов кулдауна после джекпота
COOLDOWN_PENALTY = 0.30  # множитель веса джекпота во время кулдауна (< 1 = подавление)
JACKPOT_THRESHOLD = 3.0  # стоимость ≥ cost × threshold → считается джекпотом


# ── Публичные функции ─────────────────────────────────────────────────────────

def is_jackpot(
    item: dict,
    get_value: Callable[[dict], int | float],
    cost: int | float,
    threshold: float = JACKPOT_THRESHOLD,
) -> bool:
    """Возвращает True, если предмет считается джекпотом."""
    return get_value(item) >= cost * threshold


def roll_with_pity(
    items: list[dict],
    get_value: Callable[[dict], int | float],
    cost: int | float,
    pity_count: int,
    cooldown_count: int,
    jackpot_threshold: float = JACKPOT_THRESHOLD,
    soft_pity_start: int = SOFT_PITY_START,
    hard_pity: int = HARD_PITY,
    soft_pity_boost: float = SOFT_PITY_BOOST,
    cooldown_penalty: float = COOLDOWN_PENALTY,
) -> dict:
    """
    Выбирает предмет из списка с учётом системы пити и кулдауна.

    Параметры
    ─────────
    items           — список предметов из конфига (каждый имеет ключ "chance")
    get_value       — функция item → стоимость в звёздах
    cost            — цена кейса / рулетки в звёздах
    pity_count      — кол-во подряд идущих спинов без джекпота
    cooldown_count  — оставшиеся спины кулдауна после последнего джекпота
    """
    active = [i for i in items if i.get("chance", 0) > 0]
    if not active:
        # Если все шансы = 0, возвращаем первый попавшийся предмет.
        return items[0]

    jackpots = [i for i in active if get_value(i) >= cost * jackpot_threshold]
    commons  = [i for i in active if get_value(i) <  cost * jackpot_threshold]

    # ── Жёсткое пити: гарантированный джекпот ───────────────────────────────
    if pity_count >= hard_pity and jackpots:
        return _pick(jackpots)

    # ── Вычисляем множитель для джекпот-предметов ───────────────────────────
    if cooldown_count > 0:
        # Кулдаун: подавляем джекпоты
        jmult = cooldown_penalty
    elif pity_count >= soft_pity_start:
        # Мягкое пити: усиливаем джекпоты
        above = pity_count - soft_pity_start
        jmult = 1.0 + above * soft_pity_boost
    else:
        jmult = 1.0

    # ── Взвешенный ролл с применённым множителем ────────────────────────────
    weighted: list[tuple[dict, float]] = []
    for item in active:
        base_chance = float(item.get("chance", 0))
        if base_chance <= 0:
            continue
        if item in jackpots:
            base_chance *= jmult
        weighted.append((item, base_chance))

    if not weighted:
        return active[0]

    total = sum(c for _, c in weighted)
    r     = random.uniform(0, total)
    cumulative = 0.0
    for item, chance in weighted:
        cumulative += chance
        if r <= cumulative:
            return item

    return weighted[-1][0]


# ── Приватные утилиты ─────────────────────────────────────────────────────────

def _pick(items: list[dict]) -> dict:
    """Равномерный случайный выбор из списка (используется для hard pity)."""
    total = sum(i.get("chance", 1) for i in items)
    if total <= 0:
        return random.choice(items)
    r = random.uniform(0, total)
    cumulative = 0.0
    for item in items:
        cumulative += item.get("chance", 1)
        if r <= cumulative:
            return item
    return items[-1]


def compute_ev(items: list[dict], get_value: Callable[[dict], int | float]) -> float:
    """
    Вычисляет математическое ожидание выигрыша (в звёздах) при текущих шансах.
    Полезно для проверки house edge в конфиге.

    Пример:
        ev = compute_ev(case["items"], _get_item_value_stars)
        house_edge_pct = (1 - ev / case["price"]) * 100
        print(f"House edge: {house_edge_pct:.1f}%")
    """
    total_chance = sum(i.get("chance", 0) for i in items)
    if total_chance <= 0:
        return 0.0
    ev = 0.0
    for item in items:
        chance = item.get("chance", 0)
        if chance > 0:
            ev += (chance / total_chance) * get_value(item)
    return ev
