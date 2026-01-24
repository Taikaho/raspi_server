import { InfluxDB } from "@influxdata/influxdb-client";

const url = process.env.INFLUX_URL!;
const token = process.env.INFLUX_TOKEN!;
const org = process.env.INFLUX_ORG!;

export const influx = new InfluxDB({ url, token, timeout: 30000 });
export const influxOrg = org;
