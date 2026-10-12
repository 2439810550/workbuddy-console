import { toast } from "sonner";

import * as api from "./api";
import { demoModeEnabled } from "./demo-mode";

/**
 * 应用内通知存档：toast 只存活几秒，事后无法回看；这里把每条提示同步写一份到
 * 后端（最近 100 条，`~/.wb-switch/notifications.json`），供用户与排障者核对
 * 「应用当时到底提示了什么」（例如切号成功/失败的具体文案）。
 *
 * 实现方式：包装 sonner 的 `toast.success/error/warning/info`，既有调用点无需改动；
 * 存档失败静默，提示本身照常显示。演示模式不落盘。
 */
type Level = "success" | "error" | "warning" | "info";

const LEVELS: Level[] = ["success", "error", "warning", "info"];

/** 只存档字符串形式的标题/描述（ReactNode 提示不落盘，避免无意义序列化）。 */
function textOf(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

let installed = false;

/** 安装一次即可；重复调用无副作用。 */
export function installNotificationArchive(): void {
  if (installed || demoModeEnabled) return;
  installed = true;
  for (const level of LEVELS) {
    const original = toast[level].bind(toast) as (
      message: unknown,
      options?: { description?: unknown },
    ) => unknown;
    toast[level] = ((message: unknown, options?: { description?: unknown }) => {
      const title = textOf(message);
      if (title) {
        void api
          .recordNotification(level, title, textOf(options?.description))
          .catch(() => {});
      }
      return original(message, options);
    }) as unknown as typeof toast[typeof level];
  }
}
