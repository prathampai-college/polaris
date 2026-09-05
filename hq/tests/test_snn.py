import pathlib, sys, os
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent.parent))
from hq.app.snn_forecast import predict_snn_total, reset_snn
import json

def test_snn_gating():
    reset_snn()
    phys, res, total, active, spike = predict_snn_total(-15, 5, 1013, 24, 0.7, "ST-BHARATI")
    assert active is True
    # second call same feats -> idle (event-gated)
    phys2, res2, total2, active2, spike2 = predict_snn_total(-15, 5, 1013, 24, 0.7, "ST-BHARATI")
    assert active2 is False
    assert res2 == 0.0

def test_snn_active_on_change():
    reset_snn()
    predict_snn_total(-15, 5, 1013, 24, 0.7, "ST-BHARATI")
    phys, res, total, active, spike = predict_snn_total(-38, 22, 960, 24, 0.9, "ST-BHARATI")
    assert active is True
    assert spike > 0

def test_snn_weights_exist():
    p = pathlib.Path(__file__).parent.parent.parent / "ai" / "snn" / "snn_weights.json"
    assert p.exists()
    j = json.loads(p.read_text())
    assert len(j["weights"])==5
