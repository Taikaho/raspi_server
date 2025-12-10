#!/usr/bin/env python3
import asyncio
from pathlib import Path
from typing import Dict, Any

from influxdb_client import InfluxDBClient, Point, WriteOptions
from ruuvitag_sensor.ruuvi import RuuviTagSensor  # type: ignore

INF_ENV_PATH = Path(__file__).resolve().parents[1] / "influx.env"

# RuuviTagien MACit ja sijainnit
RUUVI_TAGS: Dict[str, str] = {
    "D5:FD:8F:58:75:FB": "inside",   # sisäruuvi
    "C2:75:55:EE:92:FE": "outside",  # ulkoruuvi
}


def load_influx_config(path: Path) -> Dict[str, str]:
    """Lataa INFLUX_* -asetukset influx.env tiedostosta."""
    if not path.exists():
        raise FileNotFoundError(f"influx.env ei löytynyt polusta {path}")

    config: Dict[str, str] = {}
    with path.open() as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            config[key.strip()] = value.strip()

    required = ["INFLUX_URL", "INFLUX_TOKEN", "INFLUX_ORG", "INFLUX_BUCKET"]
    for key in required:
        if key not in config or not config[key]:
            raise ValueError(f"Puuttuva asetus influx.env tiedostossa: {key}")
    return config


def ruuvi_data_to_point(mac: str, data: Dict[str, Any]) -> Point:
    """
    Muuntaa RuuviTag-datan InfluxDB Point-olioksi.

    data näyttää esim. tältä:
    {
      'data_format': 5,
      'humidity': 47.62,
      'temperature': 23.58,
      'pressure': 1023.68,
      'acceleration': 993.23,
      'acceleration_x': -48,
      'acceleration_y': -12,
      'acceleration_z': 992,
      'tx_power': 4,
      'battery': 2197,
      'movement_counter': 0,
      'measurement_sequence_number': 88,
      'mac': 'd2a36ec8e025',
      'rssi': -80
    }
    """
    mac_upper = mac.upper()
    location = RUUVI_TAGS.get(mac_upper, "unknown")

    p = (
        Point("ruuvi_measurement")
        .tag("mac", mac_upper)
        .tag("location", location)
    )

    # Lisätään kiinnostavat kentät, jos löytyvät
    for field in [
        "temperature",
        "humidity",
        "pressure",
        "battery",
        "rssi",
        "acceleration",
        "acceleration_x",
        "acceleration_y",
        "acceleration_z",
    ]:
        if field in data and data[field] is not None:
            p = p.field(field, float(data[field]))

    return p


async def ruuvi_loop(write_api, bucket: str, org: str) -> None:
    """
    Async-silmukka, joka lukee RuuviTagien dataa ja kirjoittaa InfluxDB:hen.
    Käyttää ruuvitag-sensorin get_data_async -metodia (Bleak-adapteri).
    """
    macs = list(RUUVI_TAGS.keys())
    print(f"Kuunnellaan RuuviTageja (async): {macs}")
    print(f"Kirjoitetaan data buckettiin '{bucket}' (org: '{org}').")
    print("Paina Ctrl+C lopettaaksesi.\n")

    async for found_data in RuuviTagSensor.get_data_async(macs):
        mac = found_data[0]
        data = found_data[1]

        mac_upper = mac.upper()
        if mac_upper not in RUUVI_TAGS:
            # varmistetaan, että vain meidän tagit käsitellään
            continue

        # Muodosta Influx-piste ja kirjoita
        point = ruuvi_data_to_point(mac_upper, data)
        write_api.write(bucket=bucket, org=org, record=point)

        temp = data.get("temperature")
        hum = data.get("humidity")
        pres = data.get("pressure")

        temp_str = f"{temp:.1f} °C" if isinstance(temp, (int, float)) else "N/A"
        hum_str = f"{hum:.1f} %" if isinstance(hum, (int, float)) else "N/A"
        pres_str = f"{pres:.1f} hPa" if isinstance(pres, (int, float)) else "N/A"

        print(
            f"{mac_upper} ({RUUVI_TAGS.get(mac_upper, 'unknown')}): "
            f"T={temp_str}  RH={hum_str}  p={pres_str}"
        )


def main() -> None:
    cfg = load_influx_config(INF_ENV_PATH)

    url = cfg["INFLUX_URL"]
    token = cfg["INFLUX_TOKEN"]
    org = cfg["INFLUX_ORG"]
    bucket = cfg["INFLUX_BUCKET"]

    print("Yhdistetään InfluxDB:hen...")
    client = InfluxDBClient(url=url, token=token, org=org)
    write_api = client.write_api(write_options=WriteOptions(batch_size=1))

    try:
        asyncio.run(ruuvi_loop(write_api, bucket, org))
    except KeyboardInterrupt:
        print("\nLopetetaan...")
    finally:
        client.close()


if __name__ == "__main__":
    main()
