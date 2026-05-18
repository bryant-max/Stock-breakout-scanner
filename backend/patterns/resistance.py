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

    The 'range' is the CONSOLIDATION zone, identified by pivot-high clustering.
    We do NOT use a raw rolling-window max (which would grab spike highs above
    actual resistance and inflate the breakout level incorrectly).

    Logic:
    - Find pivot highs in the last 60 candles, cluster them by proximity (0.3%).
    - Look for the best cluster at or near current price (the ceiling of the base).
    - FLAT_TOP (cluster >= 3 touches):
        trigger = highest daily CLOSE among candles that touched that cluster level.
        This is the "highest daily close of the range" the user specified.
    - All others (Base/Wedge/Flag):
        trigger = highest pivot high (the "range high" of the consolidation).
    """
    price = candles[-1].c

    # --- Pivot-high clustering ---
    pivots = pivot_highs(candles, 3, 3)
    recent_pivots = pivots[-20:] if len(pivots) > 20 else pivots
    pivot_prices = [p.price for p in recent_pivots]

    clusters = cluster_resistance_levels(pivot_prices, 0.3)

    # Find best cluster at or near current price (the overhead resistance ceiling)
    # Accept cluster within 3% below price (stock coiling just under resistance)
    # or any level above price
    best_cluster = None
    for c in clusters:
        if c.level >= price * 0.97:
            best_cluster = c
            break

    cluster_touches = 0
    reason = "PIVOT_HIGH"

    if best_cluster and best_cluster.touches >= 3:
        # FLAT_TOP confirmed.
        # trigger = highest daily CLOSE among candles near the cluster level.
        cluster_level = best_cluster.level
        tol = cluster_level * 0.005  # 0.5% band around cluster
        cluster_candles = [
            c for c in candles[-60:]
            if c.h >= cluster_level - tol
        ]
        if cluster_candles:
            trigger = max(c.c for c in cluster_candles)
        else:
            trigger = cluster_level
        reason = "FLAT_TOP_HIGHEST_CLOSE"
        cluster_touches = best_cluster.touches
    elif pivot_prices:
        # Base / wedge / flag — use highest pivot high = range high of consolidation
        trigger = max(pivot_prices)
        reason = "PIVOT_RANGE_HIGH"
    else:
        # Fallback: recent high
        trigger = max(c.h for c in candles[-60:]) if len(candles) >= 60 else max(c.h for c in candles)
        reason = "RECENT_HIGH_FALLBACK"

    return {
        "trigger": trigger,
        "reason": reason,
        "cluster_touches": cluster_touches,
    }
