from fastapi import APIRouter, Depends, HTTPException
import httpx

import config
import database
from handlers.models import TaskCheckData
from handlers.security import get_current_user

router = APIRouter(prefix="/api", tags=["tasks"])


@router.get("/earn_data")
async def get_earn_data(current_user: dict = Depends(get_current_user)):
    tg_id           = current_user["id"]
    referrals       = await database.get_referrals(tg_id)
    completed_tasks = await database.get_completed_tasks(tg_id)
    user_data       = await database.get_user_data(tg_id)

    tasks_list = []
    for t_id, t_data in config.TASKS.items():
        tasks_list.append({
            "id":          t_id,
            "title":       t_data["title"],
            "title_en":    t_data.get("title_en", t_data["title"]),
            "url":         t_data.get("url", ""),
            "reward":      t_data["reward"],
            "reward_type": t_data.get("reward_type", "balance"),
            "completed":   t_id in completed_tasks,
        })

    return {
        "referrals":        referrals,
        "tasks":            tasks_list,
        "ref_ton_earned":   user_data.get("ref_ton_earned", 0),
        "ref_stars_earned": user_data.get("ref_stars_earned", 0),
    }


@router.post("/check_task")
async def check_task(data: TaskCheckData, current_user: dict = Depends(get_current_user)):
    tg_id = current_user["id"]

    if data.task_id not in config.TASKS:
        raise HTTPException(status_code=400, detail="Задание не найдено")

    completed = await database.get_completed_tasks(tg_id)
    if data.task_id in completed:
        raise HTTPException(status_code=400, detail="Задание уже выполнено")

    task_info    = config.TASKS[data.task_id]
    task_type    = task_info.get("type", "subscription")
    success_status = False

    if task_type == "referral":
        required_refs = task_info.get("required_referrals", 1)
        referrals     = await database.get_referrals(tg_id)
        if len(referrals) >= required_refs:
            success_status = True
        else:
            remaining = required_refs - len(referrals)
            return {"status": "error", "detail": f"Вам нужно пригласить еще {remaining} чел. (Приглашено: {len(referrals)})"}

    else:
        chat_id = task_info.get("chat_id")
        async with httpx.AsyncClient() as client:
            try:
                if task_type == "subscription":
                    url    = f"https://api.telegram.org/bot{config.BOT_TOKEN}/getChatMember"
                    params = {"chat_id": chat_id, "user_id": tg_id}
                    resp   = await client.get(url, params=params)
                    res    = resp.json()
                    if res.get("ok"):
                        if res["result"]["status"] in ["member", "administrator", "creator"]:
                            success_status = True
                        else:
                            return {"status": "error", "detail": "Вы не подписаны на канал!"}
                    else:
                        return {"status": "error", "detail": "Ошибка проверки. Бот администратор в канале?"}

                elif task_type == "boost":
                    url    = f"https://api.telegram.org/bot{config.BOT_TOKEN}/getUserChatBoosts"
                    params = {"chat_id": chat_id, "user_id": tg_id}
                    resp   = await client.get(url, params=params)
                    res    = resp.json()
                    if res.get("ok"):
                        if len(res["result"]["boosts"]) > 0:
                            success_status = True
                        else:
                            return {"status": "error", "detail": "Вы не проголосовали за канал (нет активного буста)!"}
                    else:
                        return {"status": "error", "detail": "Ошибка проверки буста. Бот администратор в канале?"}

                else:
                    return {"status": "error", "detail": "Неизвестный тип задания."}

            except Exception as e:
                return {"status": "error", "detail": f"Ошибка соединения с Telegram API: {str(e)}"}

    if success_status:
        await database.mark_task_completed(tg_id, data.task_id)

        reward_type   = task_info.get("reward_type", "balance")
        reward_amount = task_info["reward"]

        if reward_type == "stars":
            await database.add_stars_to_user(tg_id, reward_amount)
            await database.add_history_entry(
                tg_id, "task_reward_stars",
                f"Задание выполнено (Звезды): {task_info['title']}", reward_amount
            )
        else:
            await database.add_points_to_user(tg_id, reward_amount)
            await database.add_history_entry(
                tg_id, "task_reward",
                f"Задание выполнено: {task_info['title']}", reward_amount
            )

        user_data = await database.get_user_data(tg_id)
        return {
            "status":  "ok",
            "balance": user_data.get("balance", 0),
            "stars":   user_data.get("stars", 0),
        }


@router.post("/claim_referral")
async def claim_referral(current_user: dict = Depends(get_current_user)):
    """
    Переводит накопленные реферальные TON и/или звёзды на основной баланс.

    TON    — минимум 1 TON для клейма.
    Звёзды — минимум 100 ⭐ для клейма.
    После успешного клейма накопительные счета обнуляются.
    """
    tg_id = current_user["id"]

    claimed_ton   = await database.claim_ref_ton(tg_id)
    claimed_stars = await database.claim_ref_stars(tg_id)

    if claimed_ton == 0 and claimed_stars == 0:
        raise HTTPException(
            status_code=400,
            detail="Недостаточно для получения: TON (минимум 1), Звёзды (минимум 100)"
        )

    if claimed_ton > 0:
        await database.add_history_entry(
            tg_id, "ref_claim_ton",
            f"Получение реферального TON: {claimed_ton} TON",
            claimed_ton
        )
    if claimed_stars > 0:
        await database.add_history_entry(
            tg_id, "ref_claim_stars",
            f"Получение реферальных звёзд: {claimed_stars} ⭐",
            claimed_stars
        )

    user_data = await database.get_user_data(tg_id)
    return {
        "status":           "ok",
        "claimed_ton":      claimed_ton,
        "claimed_stars":    claimed_stars,
        "ton_balance":      user_data.get("ton_balance", 0),
        "stars":            user_data.get("stars", 0),
        "ref_ton_earned":   user_data.get("ref_ton_earned", 0),
        "ref_stars_earned": user_data.get("ref_stars_earned", 0),
    }