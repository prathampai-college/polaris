"""Vector-clock helpers — single source for HQ (mirrors shared/src/dtn/vector_clock.ts)."""

def compare_vc(a: dict, b: dict) -> str:
    keys = set(a.keys()) | set(b.keys())
    a_gt = b_gt = False
    for k in keys:
        av = a.get(k, 0); bv = b.get(k, 0)
        if av > bv: a_gt = True
        if bv > av: b_gt = True
    if not a_gt and not b_gt: return "equal"
    if a_gt and not b_gt: return "gt"
    if not a_gt and b_gt: return "lt"
    return "concurrent"

def merge_vc(a: dict, b: dict) -> dict:
    out = dict(a)
    for k, v in b.items():
        out[k] = max(out.get(k, 0), v)
    return out
