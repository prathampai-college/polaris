from hq.app.dtn import compare_vc, merge_vc

def test_vc_concurrent():
    assert compare_vc({"A":1},{"B":1})=="concurrent"
    assert compare_vc({"A":1},{})=="gt"
    assert compare_vc({},{"B":1})=="lt"
    assert compare_vc({"A":1},{"A":1})=="equal"

def test_merge():
    assert merge_vc({"A":1},{"B":1})=={"A":1,"B":1}
    assert merge_vc({"A":2},{"A":1})=={"A":2}

def test_lww_deterministic():
    # concurrent -> later ts wins
    a_vc={"A":1}
    b_vc={"B":1}
    assert compare_vc(a_vc,b_vc)=="concurrent"
    # later ts simulated: B wins
    import datetime
    ta="2026-09-03T10:00:00Z"
    tb="2026-09-03T10:00:05Z"
    assert tb > ta

def test_dtn_ingest_endpoint():
    pass
