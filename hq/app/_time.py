import datetime

def utc_now() -> str:
    try:
        utc = datetime.UTC  # py3.11+
    except AttributeError:
        utc = datetime.timezone.utc
    return datetime.datetime.now(utc).isoformat()
