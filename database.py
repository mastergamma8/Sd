# database.py
# Единая точка входа для всего кода проекта.

from db.db_core import DB_NAME, GIFT_WITHDRAW_COOLDOWN, GIFT_CLAIM_COOLDOWN  # noqa: F401

from db.db_init import init_db, init_rocket_games_table  # noqa: F401
from db.db_promos import init_promo_tables  # noqa: F401
from db.db_settings import (  # noqa: F401
    init_settings_table,
    get_maintenance_mode,
    set_maintenance_mode,
    get_feature_flags,
    set_feature_flag,
    init_beta_testers_table,
    add_beta_tester,
    remove_beta_tester,
    get_beta_testers,
    is_beta_tester,
)

from db.db_users import (  # noqa: F401
    upsert_user,
    get_user_profile,
    get_user_data,
    get_all_user_ids,
    add_points_to_user,
    add_stars_to_user,
    deduct_stars,
    deduct_balance,
    update_last_free_spin,
    claim_free_spin_atomic,
    get_users_to_notify,
    mark_user_notified,
    get_last_free_case,
    update_last_free_case,
    claim_free_case_atomic,
    get_users_to_notify_free_case,
    mark_user_notified_free_case,
    claim_main_gift,
    get_last_gift_claim,
    update_last_gift_claim,
    get_users_to_notify_gift_claim,
    mark_user_notified_gift_claim,
    get_last_gift_withdraw,
    update_last_gift_withdraw,
    get_users_to_notify_gift_withdraw,
    mark_user_notified_gift_withdraw,
    add_gift_to_user,
    remove_gift_from_user,
    get_user_gifts,
    get_user_settings,
    update_user_settings,
)

from db.db_history import (  # noqa: F401
    get_completed_tasks,
    mark_task_completed,
    add_history_entry,
    log_action,
    get_user_history,
    get_user_history_count,
)

from db.db_referrals import (  # noqa: F401
    set_referrer,
    get_referrer,
    get_referrals,
    distribute_referral_bonus,
)

from db.db_leaderboard import (  # noqa: F401
    get_leaderboard,
    get_user_rich_rank,
    get_rocket_leaderboard,
    get_rocket_leaderboard_full,
    get_lucky_leaderboard,
    get_user_lucky_rank,
    get_alltime_leaderboard,
    get_user_alltime_rank,
)

from db.db_bank import (  # noqa: F401
    init_bank,
    get_bank,
    bank_deposit,
    bank_can_payout,
    bank_payout,
    deduct_and_deposit_atomic,
    bank_get_max_payout,
    bank_add_stars,
    bank_add_donuts,
    # Статистика (новое)
    get_bank_day_stats,
    get_bank_day_history,
    get_top_active_today,
    get_bank_earnings_summary,
    # PvP — запись статистики в банк
    bank_record_pvp_game,
)

from db.db_rocket import (  # noqa: F401
    rocket_start_game,
    rocket_start_atomic,
    rocket_get_game,
    rocket_end_game,
)

from db.db_pvp import (  # noqa: F401
    load_pvp_round_state,
    save_pvp_round_state,
    load_rocket_round_id,
    save_rocket_round_id,
    save_pvp_game_to_history,
    get_pvp_history,
    get_pvp_history_count,
)

from db.db_promos import (  # noqa: F401
    create_promo_code,
    delete_promo_code,
    get_promo_code,
    has_user_redeemed_promo,
    get_user_promo_cases,
    remove_user_promo_case,
    consume_user_promo_case,
    redeem_promo_code,
    get_all_promo_codes,
)

from db.db_users import claim_payment_idempotent  # noqa: F401
from db.db_users import create_invoice_record, claim_invoice  # noqa: F401
