"""
handlers/models.py
Pydantic-модели для тел запросов.

tg_id УДАЛЁН из всех моделей: сервер извлекает user_id самостоятельно
через get_current_user (handlers/security.py).
"""
from pydantic import BaseModel


class UserInitData(BaseModel):
    """Данные инициализации. username/first_name/photo_url берутся из TG InitData."""
    username:   str = ""
    first_name: str = ""
    photo_url:  str = ""


class ActionData(BaseModel):
    gift_id: int


class TaskCheckData(BaseModel):
    task_id: int


class SpinData(BaseModel):
    pass


class RocketBetData(BaseModel):
    bet: int


class RocketCashoutData(BaseModel):
    multiplier: float


class TopupData(BaseModel):
    stars_amount: int


class AdminBankTopup(BaseModel):
    amount:     int
    asset_type: str = "stars"   # "stars" | "donuts"



class PromoRedeemData(BaseModel):
    code: str


class UserSettingsData(BaseModel):
    is_anonymous: bool
    hide_username: bool
