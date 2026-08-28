"""MQTT telemetry bridge — subscribes to polaris/telemetry/# and publishes on POST /telemetry."""
import os, json, logging, threading

logger = logging.getLogger("polaris.hq.mqtt")

MQTT_BROKER_URL = os.getenv("MQTT_BROKER_URL", "")  # e.g. "broker.emqx.io:1883"
MQTT_ENABLED = os.getenv("MQTT_ENABLED", "false").lower() in ("true", "1", "yes")
MQTT_TOPIC_PREFIX = os.getenv("MQTT_TOPIC_PREFIX", "polaris/telemetry")

_client = None
_handler = None  # callback(tele_dict)


def _on_connect(client, userdata, flags, rc, properties=None):
    if rc == 0:
        topic = f"{MQTT_TOPIC_PREFIX}/#"
        client.subscribe(topic)
        logger.info(f"[mqtt] connected, subscribed to {topic}")
    else:
        logger.warning(f"[mqtt] connect failed rc={rc}")


def _on_message(client, userdata, msg):
    try:
        data = json.loads(msg.payload.decode("utf-8"))
        if _handler:
            _handler(data)
        logger.debug(f"[mqtt] received on {msg.topic}: {data.get('station_id','?')}")
    except Exception as e:
        logger.warning(f"[mqtt] message parse error: {e}")


def init_mqtt(on_telemetry):
    """Initialize MQTT client and connect. on_telemetry(tele_dict) called on each message."""
    global _client, _handler
    if not MQTT_ENABLED or not MQTT_BROKER_URL:
        logger.info("[mqtt] disabled (set MQTT_ENABLED=true and MQTT_BROKER_URL to enable)")
        return
    _handler = on_telemetry
    try:
        import paho.mqtt.client as mqtt
        _client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        _client.on_connect = _on_connect
        _client.on_message = _on_message
        host = MQTT_BROKER_URL.split(":")[0]
        port = int(MQTT_BROKER_URL.split(":")[1]) if ":" in MQTT_BROKER_URL else 1883
        _client.connect_async(host, port, keepalive=60)
        _client.loop_start()
        logger.info(f"[mqtt] connecting to {MQTT_BROKER_URL}")
    except Exception as e:
        logger.error(f"[mqtt] init failed: {e}")


def publish_telemetry(tele: dict):
    """Publish telemetry dict to MQTT topic polaris/telemetry/{station_id}."""
    if not _client:
        return
    station_id = tele.get("station_id", "unknown")
    topic = f"{MQTT_TOPIC_PREFIX}/{station_id}"
    try:
        _client.publish(topic, json.dumps(tele), qos=1)
        logger.debug(f"[mqtt] published to {topic}")
    except Exception as e:
        logger.warning(f"[mqtt] publish error: {e}")


def shutdown_mqtt():
    global _client
    if _client:
        try:
            _client.loop_stop()
            _client.disconnect()
        except Exception:
            pass
        _client = None
