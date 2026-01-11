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

// Latest metrics path
  app.get("/api/metrics/latest", async (req, reply) => {
    const q = req.query as { mac?: string };

    const macs =
      q.mac?.split(",").map((m) => m.trim().toUpperCase()) ??
      DEFAULT_MACS;

    const flux = `
macs = ${JSON.stringify(macs)}

from(bucket: "${bucket}")
  |> range(start: -7d)
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
  |> pivot(
    rowKey: ["mac"],
    columnKey: ["_field"],
    valueColumn: "_value"
  )
  |> keep(columns: ["mac", "_time", "temperature", "humidity", "pressure", "battery", "rssi"])
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

    const data = rows.map((r) => ({
      mac: r.mac,
      time: r._time,
      temperature: r.temperature ?? null,
      humidity: r.humidity ?? null,
      pressure: r.pressure ?? null,
      battery: r.battery ?? null, // mV
      rssi: r.rssi ?? null,
    }));

    return reply.send({
      count: data.length,
      data,
    });
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
