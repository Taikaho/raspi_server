#!/usr/bin/env python3
import time
import psutil
from pathlib import Path

from influxdb_client import InfluxDBClient, Point, WriteOptions

TEMP_PATH = "/sys/class/thermal/thermal_zone0/temp"
INF_ENV_PATH = Path(__file__).resolve().parents[1] / "influx.env"


def read_cpu_temp_c():
    with open(TEMP_PATH, "r") as f:
        milli_c = int(f.read().strip())
    return milli_c / 1000.0


def load_influx_config(path: Path):
    """Lataa INFLUX_* -asetukset influx.env tiedostosta."""
    if not path.exists():
        raise FileNotFoundError(f"influx.env ei löytynyt polusta {path}")

    config = {}
    with path.open() as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, value = line.split("=", 1)
            config[key.strip()] = value.strip()

    required = ["INFLUX_URL", "INFLUX_TOKEN", "INFLUX_ORG", "INFLUX_BUCKET"]
    for key in required:
        if key not in config or not config[key]:
            raise ValueError(f"Puuttuva asetus influx.env tiedostossa: {key}")
    return config


def main():
    cfg = load_influx_config(INF_ENV_PATH)

    url = cfg["INFLUX_URL"]
    token = cfg["INFLUX_TOKEN"]
    org = cfg["INFLUX_ORG"]
    bucket = cfg["INFLUX_BUCKET"]

    print("Yhdistetään InfluxDB:hen...")
    client = InfluxDBClient(url=url, token=token, org=org)
    write_api = client.write_api(write_options=WriteOptions(batch_size=1))

    print(f"Kirjoitetaan mittausdataa buckettiin '{bucket}' (org: '{org}').")
    print("Paina Ctrl+C lopettaaksesi.\n")

    try:
        while True:
            cpu = psutil.cpu_percent(interval=1.0)
            memory = psutil.virtual_memory().percent
            temp = read_cpu_temp_c()

            point = (
                Point("raspi_cpu")
                .tag("host", "raspi")
                .field("cpu_percent", float(cpu))
                .field("mem_percent", float(memory))
                .field("cpu_temp_c", float(temp))
            )

            write_api.write(bucket=bucket, org=org, record=point)

            print(f"Lähetetty: CPU={cpu:5.1f}% | Lämpö={temp:5.1f} °C | Muisti={memory:5.1f}%")
            time.sleep(4)  # n. 5 s välein

    except KeyboardInterrupt:
        print("\nLopetetaan...")
    finally:
        client.close()


if __name__ == "__main__":
    main()
