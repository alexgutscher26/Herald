import { describe, expect, test } from "bun:test";

import {
  findSensitiveInfo,
  sensitiveInfoMessage,
} from "@/features/public/sensitive";

describe("findSensitiveInfo", () => {
  test("flags a Luhn-valid payment card number", () => {
    expect(findSensitiveInfo("card 4111 1111 1111 1111")).toContain("payment_card");
  });

  test("ignores a long number that is not a valid card", () => {
    expect(findSensitiveInfo("order 1234 5678 9012 3456")).not.toContain(
      "payment_card",
    );
  });

  test("flags cloud keys and private keys", () => {
    expect(findSensitiveInfo("AKIAIOSFODNN7EXAMPLE")).toContain("cloud_key");
    expect(
      findSensitiveInfo("-----BEGIN RSA PRIVATE KEY-----\nabc"),
    ).toContain("private_key");
  });

  test("flags password and API key assignments", () => {
    expect(findSensitiveInfo("password: hunter2hunter2")).toContain("credential");
    expect(findSensitiveInfo("api_key=abcdef123456")).toContain("credential");
  });

  test("leaves ordinary feedback alone", () => {
    expect(
      findSensitiveInfo("The editor crashes when I paste a large table."),
    ).toEqual([]);
  });

  test("reports every finding once", () => {
    const findings = findSensitiveInfo(
      "password: hunter2hunter2 AKIAIOSFODNN7EXAMPLE",
    );
    expect(findings).toEqual(["cloud_key", "credential"]);
  });
});

describe("sensitiveInfoMessage", () => {
  test("names the finding without echoing the value", () => {
    const message = sensitiveInfoMessage(["payment_card"]);
    expect(message).toContain("payment card");
    expect(message).not.toContain("4111");
  });
});
