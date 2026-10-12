import { describe, expect, it } from "vitest";

import { creditResourceName } from "./credit-package-names";

const FALLBACK = "积分包";

describe("creditResourceName 命中官方商品码映射", () => {
  it("个人标准版取官方中文名", () => {
    expect(
      creditResourceName(
        { packageCode: "TCACA_code_003_FAnt7lcmRT", packageName: "运营原文" },
        FALLBACK,
      ),
    ).toBe("CodeBuddy 个人标准版");
  });

  it("购买积分取官方中文名", () => {
    expect(
      creditResourceName({ packageCode: "TCACA_code_009_0XmEQc2xOf", packageName: null }, FALLBACK),
    ).toBe("购买积分");
  });

  it("平台奖励积分取官方中文名", () => {
    expect(
      creditResourceName({ packageCode: "TCACA_code_007_nzdH5h4Nl0", packageName: null }, FALLBACK),
    ).toBe("平台奖励积分");
  });

  it("命中映射时忽略后端下发的 PackageName", () => {
    expect(
      creditResourceName(
        { packageCode: "TCACA_code_028_NtpWi0jzXs", packageName: "运营原文" },
        FALLBACK,
      ),
    ).toBe("版本赠送用量");
  });
});

describe("creditResourceName 未命中回落链", () => {
  it("未登记商品码回落到 packageName", () => {
    expect(
      creditResourceName(
        { packageCode: "TCACA_code_999_unregistered", packageName: "运营名称" },
        FALLBACK,
      ),
    ).toBe("运营名称");
  });

  it("未登记商品码且无 packageName 时回落到 packageCode", () => {
    expect(
      creditResourceName({ packageCode: "TCACA_code_999_unregistered", packageName: null }, FALLBACK),
    ).toBe("TCACA_code_999_unregistered");
  });

  it("两个字段都为 null 时回落到调用点文案", () => {
    expect(creditResourceName({ packageCode: null, packageName: null }, FALLBACK)).toBe(FALLBACK);
  });

  it("空字符串与 null 等价处理", () => {
    expect(creditResourceName({ packageCode: "", packageName: "" }, FALLBACK)).toBe(FALLBACK);
    expect(creditResourceName({ packageCode: "", packageName: "运营名称" }, FALLBACK)).toBe(
      "运营名称",
    );
  });

  it("packageCode 为空时不因 packageName 为空串而漏掉兜底", () => {
    expect(creditResourceName({ packageCode: null, packageName: "" }, FALLBACK)).toBe(FALLBACK);
  });

  it("fallback 为空串时原样返回", () => {
    expect(creditResourceName({ packageCode: null, packageName: null }, "")).toBe("");
  });
});
