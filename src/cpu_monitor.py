#!/usr/bin/env python3
import time
import psutil

TEMP_PATH = "/sys/class/thermal/thermal_zone0/temp"

def read_cpu_temp_c():
    """Reads CPU temperature in degrees Celsius."""
    with open(TEMP_PATH, "r") as f:
        milli_c = int(f.read().strip())
    return milli_c / 1000.0

def main():
    print("CPU monitori käynnissä. Paina Ctrl+C lopettaaksesi.\n")
    while True:
        cpu = psutil.cpu_percent(interval=1.0)       # CPU load (%)
        memory = psutil.virtual_memory().percent     # RAM usage (%)
        temp = read_cpu_temp_c()                     # CPU temp (°C)

        print(f"CPU: {cpu:5.1f}% | Lämpö: {temp:5.1f} °C | Muisti: {memory:5.1f}%")
        time.sleep(4)  # total loop time ~5 sec (1s measurement + 4s wait)

if __name__ == "__main__":
    main()
