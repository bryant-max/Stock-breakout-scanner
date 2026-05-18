from typing import List, NamedTuple, Optional
from models.candle import Candle
from indicators.pivots import pivot_highs

class Cluster(NamedTuple):
    level: float
    touches: int
    members: List[float]

def cluster_resistance_levels(
    highs: List[float], tolerance_pct: float = 0.3
) -> List[Cluster]:
    """Cluster resistance levels by proximity."""
    sorted_highs = sorted(highs)
    clusters = []

    for p in sorted_highs:
        placed = False
        for i, c in enumerate(clusters):
            tol = (c.level * tolerance_pct) / 100
            if abs(p - c.level) <= tol:
                new_level = (c.level * c.touches + p) / (c.touches + 1)
                clusters[i] = Cluster(
                    level=new_level,
                    touches=c.touches + 1,
                    members=c.members + [p],
                )
                placed = True
                break

        if not placed:
            clusters.append(Cluster(level=p, touches=1, members=[p]))

    clusters.sort(key=lambda x: x.touches, reverse=True)
    return clusters


def find_inside_day_high(candles: List[Candle]) -> Optional[float]:
    """Find inside day high (price contained within previous candle)."""
    if len(candles) < 3:
        return None
    a = candles[-2]
    b = candles[-1]
    if b.h <= a.h and b.l >= a.l:
        return b.h
    return None


def pick_trigger_price(candles: List[Candle]) -> dict:
    """
    Select breakout trigger level.

    Rule: Breakout level = range high or highest daily close of the range.

    - Use the last 40 candles as the consolidation window (current range).
    - range_high    = max intraday high  in that window
    - highest_close = max daily close    in that window

    For FLAT_TOP setups (cluster >= 3 touches of pivot highs):
        trigger = highest_close  — price must CLOSE above flat resistance to confirm.

    For all other setups (wedge, flag, base, swing high):
        trigger = range_high     — the top of the range is the breakout line.

    Cluster detection is still used to identify FLAT_TOP (drives setup_type),
    but the trigger VALUE comes from range_high / highest_close, not the cluster mean.
    """
    # --- Consolidation window: last 40 trading days ---
    RANGE_WINDOW = 40
    range_candles = candles[-RANGE_WINDOW:] if len(candles) >= RANGE_WINDOW else candles

    range_high     = max(c.h for c in range_candles)
    highest_close  = max(c.c for c in range_candles)

    # --- Flat top detection via pivot-high clustering ---
    pivots = pivot_highs(candles, 3, 3)
    recent_pivots = pivots[-20:] if len(pivots) > 20 else pivots
    pivot_prices  = [p.price for p in recent_pivots]

    clusters = cluster_resistance_levels(pivot_prices, 0.3)
    best_cluster = clusters[0] if clusters else None

    cluster_touches = 0
    reason = "RANGE_HIGH"

    if best_cluster and best_cluster.touches >= 3:
        # Flat top confirmed — use highest close so trigger = level price must close above
        trigger = highest_close
        reason  = "FLAT_TOP_HIGHEST_CLOSE"
        cluster_touches = best_cluster.touches
    else:
        # Base / wedge / flag / swing — use intraday range high as breakout line
        trigger = range_high
        reason  = "RANGE_HIGH"

    return {
        "trigger": trigger,
        "reason": reason,
        "cluster_touches": cluster_touches,
    }
