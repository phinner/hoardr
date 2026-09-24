import { Schema } from "effect";

const MAX_UINT64 = 18_446_744_073_709_551_615n;
const decimalSnowflake = /^[1-9][0-9]{0,19}$/;

export const Snowflake = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter(
      (value) => decimalSnowflake.test(value) && BigInt(value) <= MAX_UINT64,
      { message: "Expected an unsigned 64-bit decimal ID" },
    ),
  ),
  Schema.brand("Snowflake"),
);

export const HttpUrl = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter(
      (value) => {
        try {
          const protocol = new URL(value).protocol;
          return protocol === "http:" || protocol === "https:";
        } catch {
          return false;
        }
      },
      { message: "Expected an HTTP or HTTPS URL" },
    ),
  ),
);

export const UtcIsoDateTime = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter(
      (value) => {
        const milliseconds = Date.parse(value);
        return (
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
          Number.isFinite(milliseconds) &&
          new Date(milliseconds).toISOString() === value
        );
      },
      { message: "Expected a canonical UTC ISO date-time string" },
    ),
  ),
);
