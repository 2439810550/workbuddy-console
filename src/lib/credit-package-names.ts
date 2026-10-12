// 积分资源包名的前端单一事实来源：
// 官方客户端的权威做法是「国内版不用后端下发的 PackageName（那是运营原文），
// 统一按商品码映射成前端文案；国际版才用 PackageName」，未登记商品码才回落 PackageName。
// 这里照抄同一张映射表（快照来源：官方客户端 asar 内
// packages/agent-provider/src/backend/package-name-resolver.ts），两档位一致生效。
// 官方新增商品码时需手工同步；未登记的码保持原有回落链，不会漏展示。

import type { CreditResource } from "./types";

/** 商品码 → 官方中文名；键为官方下发的完整商品码。 */
const CREDIT_PACKAGE_NAMES: Record<string, string> = {
  TCACA_code_001_PqouKr6QWV: "CodeBuddy 个人体验版",
  TCACA_code_002_AkiJS3ZHF5: "版本基础用量",
  TCACA_code_003_FAnt7lcmRT: "CodeBuddy 个人标准版",
  TCACA_code_005_maRGyrHhw1: "版本基础用量",
  TCACA_code_006_DbXS0lrypC: "CodeBuddy 个人体验版",
  TCACA_code_007_nzdH5h4Nl0: "平台奖励积分",
  TCACA_code_008_cfWoLwvjU4: "版本基础用量",
  TCACA_code_009_0XmEQc2xOf: "购买积分",
  TCACA_code_023_4xbGhMrE6q: "版本基础用量",
  TCACA_code_026_BaESVICNoi: "版本基础用量",
  TCACA_code_027_0FCGVA6vSa: "版本基础用量",
  TCACA_code_028_NtpWi0jzXs: "版本赠送用量",
  TCACA_code_029_6wCGEWquYy: "平台奖励积分",
  TCACA_code_030_BjSt89qTvr: "平台奖励积分",
  TCACA_code_035_ArVxJcGDsm: "版本基础用量",
  TCACA_code_036_lupO5WgNdG: "购买积分",
  TCACA_code_037_WxOD3MpI2o: "版本赠送用量",
  TCACA_code_038_OhvqZtiPKr: "购买积分",
  TCACA_code_039_KRcQj7wUat: "版本基础用量",
  TCACA_code_040_mi9rCYg46x: "版本基础用量",
};

/**
 * 资源包展示名：商品码命中官方映射时用官方中文名；未命中保持原回落链
 * （`packageName` → `packageCode` → 调用点兜底文案）。
 */
export function creditResourceName(
  resource: Pick<CreditResource, "packageCode" | "packageName">,
  fallback: string,
): string {
  if (resource.packageCode) {
    const officialName = CREDIT_PACKAGE_NAMES[resource.packageCode];
    if (officialName) return officialName;
  }
  return resource.packageName || resource.packageCode || fallback;
}
