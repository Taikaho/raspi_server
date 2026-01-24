import { FastifyInstance } from "fastify";
import { influx, influxOrg } from "../influx";

const bucket = process.env.INFLUX_BUCKET!;

// RuuviTag MACit (voit myöhemmin siirtää konffiin)
const DEFAULT_MACS = [
  "D5:FD:8F:58:75:FB", // inside
  "C2:75:55:EE:92:FE", // outside
];

/**
 * /api/metrics/*
 */
export async function metricsRoutes(app: FastifyInstance) {

app.get("/api/metrics/latest", async (req, reply) => {
  const q = req.query as { mac?: string };

  const macs =
    q.mac?.split(",").map((m) => m.trim().toUpperCase()) ??
    DEFAULT_MACS;

  // Latest metrics path
  const flux = `
macs = ${JSON.stringify(macs)}

from(bucket: "${bucket}")
  |> range(start: -2h)
  |> filter(fn: (r) => r._measurement == "ruuvi_measurement")
  |> filter(fn: (r) =>
    r._field == "temperature" or
    r._field == "humidity" or
    r._field == "pressure" or
    r._field == "battery" or
    r._field == "rssi"
  )
  |> filter(fn: (r) => contains(value: r.mac, set: macs))
  |> group(columns: ["mac", "_field"])
  |> last()
  |> keep(columns: ["_time", "mac", "_field", "_value"])
`;

  const queryApi = influx.getQueryApi(influxOrg);
  const rows: any[] = [];

  await new Promise<void>((resolve, reject) => {
    queryApi.queryRows(flux, {
      next: (row, meta) => rows.push(meta.toObject(row)),
      error: reject,
      complete: resolve,
    });
  });


  const byMac: Record<string, any> = {};

  for (const r of rows) {
    const mac = (r.mac ?? "").toUpperCase();
    if (!mac) continue;

    if (!byMac[mac]) {
      byMac[mac] = { mac, time: r._time };
    }

    // päivitä time “uusimpaan” jos tulee eri fieldiltä eri aikaan
    if (r._time && (!byMac[mac].time || r._time > byMac[mac].time)) {
      byMac[mac].time = r._time;
    }

    byMac[mac][r._field] = r._value;
  }

  const data = Object.values(byMac).map((x: any) => ({
    mac: x.mac,
    time: x.time ?? null,
    temperature: x.temperature ?? null,
    humidity: x.humidity ?? null,
    pressure: x.pressure ?? null,
    battery: x.battery ?? null,
    rssi: x.rssi ?? null,
  }));

  return reply.send({ count: data.length, data });
});


//History metrics path
  app.get("/api/metrics/history", async (req, reply) => {
    const q = req.query as {
      mac?: string;
      location?: "inside" | "outside";
      field?: string;
      range?: string;
      window?: string;
    };

    const field = q.field ?? "temperature";
    const range = q.range ?? "-24h";
    const window = q.window ?? "1m";

    const macFilter = q.mac
      ? `r.mac == "${q.mac.toUpperCase()}"`
      : "true";

    const locationFilter = q.location
      ? `r.location == "${q.location}"`
      : "true";

    const flux = `
from(bucket: "${bucket}")
  |> range(start: ${range})
  |> filter(fn: (r) => r._measurement == "ruuvi_measurement")
  |> filter(fn: (r) => r._field == "${field}")
  |> filter(fn: (r) => (${macFilter}) and (${locationFilter}))
  |> aggregateWindow(every: ${window}, fn: mean, createEmpty: false)
  |> keep(columns: ["_time", "_value", "mac", "location"])
`;

    const queryApi = influx.getQueryApi(influxOrg);
    const rows: any[] = [];

    await new Promise<void>((resolve, reject) => {
      queryApi.queryRows(flux, {
        next: (row, meta) => rows.push(meta.toObject(row)),
        error: reject,
        complete: resolve,
      });
    });

   const points = rows.map((r) => ({
      time: r._time,
      value: r._value,
      mac: r.mac ?? null,
      location: r.location ?? null,
    }));

    return reply.send({
      measurement: "ruuvi_measurement",
      field,
      range,
      window,
      count: points.length,
      points,
    });
  });
}

