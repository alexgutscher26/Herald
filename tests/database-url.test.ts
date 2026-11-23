import { describe, expect, test } from "bun:test";

import { normalizeSslMode } from "@/db/connection-string";

describe("database connection string", () => {
  test("rewrites the sslmode aliases pg already treats as verify-full", () => {
    for (const mode of ["prefer", "require", "verify-ca", "REQUIRE"]) {
      expect(normalizeSslMode(`postgresql://u:p@db.example.com/herald?sslmode=${mode}`)).toBe(
        "postgresql://u:p@db.example.com/herald?sslmode=verify-full",
      );
    }
  });

  test("keeps every other query parameter as it was supplied", () => {
    expect(
      normalizeSslMode(
        "postgresql://u:p@db.example.com/herald?application_name=herald&sslmode=require&connect_timeout=10",
      ),
    ).toBe(
      "postgresql://u:p@db.example.com/herald?application_name=herald&sslmode=verify-full&connect_timeout=10",
    );
  });

  test("leaves explicit sslmode values, absent queries and libpq opt-ins alone", () => {
    const untouched = [
      "postgresql://u:p@db.example.com/herald?sslmode=verify-full",
      "postgresql://u:p@db.example.com/herald?sslmode=disable",
      "postgresql://u:p@db.example.com/herald",
      "postgresql://u:p@db.example.com/herald?application_name=herald",
      "postgresql://u:p@db.example.com/herald?sslmode=require&uselibpqcompat=true",
    ];

    for (const url of untouched) expect(normalizeSslMode(url)).toBe(url);
  });

  test("does not rewrite credentials that contain the alias text", () => {
    const url = "postgresql://u:sslmode=require@db.example.com/herald?application_name=herald";
    expect(normalizeSslMode(url)).toBe(url);
  });
});
