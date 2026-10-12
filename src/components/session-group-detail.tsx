import { useLayoutEffect, useRef, useState } from "react";
import { ArrowRight, Check, ChevronDown, ChevronLeft, Copy, Ellipsis, FileText, Folder, Info, Link2, Loader2, Plus, RefreshCw, TriangleAlert, Unlink, X } from "lucide-react";
import { DemoAction } from "@/components/demo-action";
import { CodeBuddyAiIdeMark, CodeBuddyCnIdeMark, VscodeExtAiMark, VscodeExtMark, WorkBuddyAiMark, WorkBuddyMark } from "@/components/product-marks";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverArrow, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { displayName } from "@/lib/account-display";
import { accountVariant, variantIsIntl, variantLabel } from "@/lib/variant";
import type { SessionGroupClient, SessionGroupCurrentAccount, SessionGroupDetail, SessionGroupMemberDetail, SessionGroupUnifyPlan } from "@/lib/types";
import "./session-group-detail.css";

export interface GroupDetailPanelProps {
  client: SessionGroupClient;
  detail: SessionGroupDetail | null;
  currentAccounts: SessionGroupCurrentAccount[];
  sourceMemberId: string;
  setSourceMemberId: (id: string) => void;
  addTargetId: string;
  setAddTargetId: (id: string) => void;
  unifyPlan: SessionGroupUnifyPlan | null;
  unifyLoading: string | null;
  setUnifyPlan: (plan: SessionGroupUnifyPlan | null) => void;
  busy: boolean;
  error: string | null;
  loading: boolean;
  onClose: () => void;
  onRetry: () => void;
  onPrepareUnify: (member: SessionGroupMemberDetail) => void;
  onConfirmUnify: () => Promise<void>;
  onBatchSync: () => void;
  onAdd: () => Promise<void>;
  onUnlinkMember: (member: SessionGroupMemberDetail) => Promise<void>;
  addOpen: boolean;
  setAddOpen: (open: boolean) => void;
  fullPage: boolean;
}

const clientNames: Record<SessionGroupClient, string> = {
  workbuddy: "WorkBuddy", codebuddyIde: "CodeBuddy IDE", vscodeExt: "CodeBuddy 插件",
};

type GraphLine = { path: string; tone: "default" | "common" | `branch-${number}`; points: { x: number; y: number }[] };

export function GroupDetailPanel(props: GroupDetailPanelProps) {
  const { detail } = props;
  // 只存被点成员 id，确认框的成员由当前 detail 派生：浮层不会停留在过期数据上。
  const [unlinkTargetId, setUnlinkTargetId] = useState<string | null>(null);
  const [unlinkBusy, setUnlinkBusy] = useState(false);
  const unlinkTarget = detail?.members.find((member) => member.memberId === unlinkTargetId) ?? null;
  const graphRef = useRef<HTMLDivElement>(null);
  const [connections, setConnections] = useState<GraphLine[]>([]);
  useLayoutEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    function measure() {
      if (!graph) return;
      const svg = graph.querySelector("svg");
      const matrix = svg?.getScreenCTM();
      if (!matrix) return;
      // 屏幕坐标包含弹窗缩放；还原到 SVG 坐标，连线才不会被二次缩放。
      const inverse = matrix.inverse();
      const toLocal = (x: number, y: number) => new DOMPoint(x, y).matrixTransform(inverse);
      const hub = graph.querySelector<HTMLElement>("[data-session-hub]")?.getBoundingClientRect();
      if (!hub) return;
      const nodes = [...graph.querySelectorAll<HTMLElement>("[data-session-member]")];
      const lineage = detail?.summaryStatus === "diverge" && detail.divergence;
      const hasLineage = !!lineage && nodes.every((node) => node.dataset.graphRole === "common" || node.dataset.graphRole === "branch");
      const leftCount = hasLineage ? nodes.filter((node) => node.dataset.graphRole === "common").length : Math.ceil(nodes.length / 2);
      const next = nodes.map((node, index) => {
        const box = node.getBoundingClientRect();
        const left = index < leftCount;
        const sideCount = left ? leftCount : nodes.length - leftCount;
        const sideIndex = left ? index : index - leftCount;
        const { x, y } = toLocal(left ? box.right : box.left, box.top + box.height / 2);
        const { x: hx, y: hy } = toLocal(left ? hub.left : hub.right, hub.top + hub.height * ((sideIndex + 1) / (sideCount + 1)));
        const mid = (x + hx) / 2;
        const dx = Math.sign(hx - x);
        const dy = Math.sign(hy - y);
        const radius = Math.min(12, Math.abs(hy - y) / 2, Math.abs(hx - x) / 4);
        const path = hasLineage && Math.abs(hy - y) > 1
          ? `M ${x} ${y} C ${mid} ${y} ${mid} ${hy} ${hx} ${hy}`
          : radius < 1 ? `M ${x} ${y} H ${hx}`
            : `M ${x} ${y} H ${mid - dx * radius} Q ${mid} ${y} ${mid} ${y + dy * radius} V ${hy - dy * radius} Q ${mid} ${hy} ${mid + dx * radius} ${hy} H ${hx}`;
        const tone = hasLineage ? left ? "common" as const : `branch-${Number(node.dataset.branchIndex ?? 0) % 5}` as const : "default" as const;
        return { path, tone, points: [{ x, y }, { x: hx, y: hy }] };
      });
      setConnections(next);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(graph);
    graph.querySelectorAll<HTMLElement>("[data-session-member], [data-session-hub]").forEach((node) => observer.observe(node));
    measure();
    return () => observer.disconnect();
  }, [detail]);

  const active = detail?.members.filter((member) => member.linkState === "active") ?? [];
  const equal = detail?.summaryStatus === "latest" && active.length > 0;
  const sourceOptions = active.filter((member) => member.canBeSource);
  const selectedSource = sourceOptions.find((member) => member.memberId === props.sourceMemberId);
  // Batch sync chooses its own verified source on the backend, independently of the copy form.
  const batchSource = active.find((member) => member.memberId === detail?.safeSourceMemberId);
  const behind = active.filter((member) => member.versionStatus === "behind");
  const canBatch = !!batchSource && behind.length > 0;
  const conflict = detail?.summaryStatus === "diverge";
  const divergence = conflict ? detail?.divergence : undefined;
  const commonMemberIds = new Set(divergence?.commonMemberIds ?? []);
  const branchOf = new Map(divergence?.branches.flatMap((branch, index) => branch.map((memberId) => [memberId, index] as const)) ?? []);
  const displayMembers = divergence
    ? [...detail!.members].sort((left, right) => {
      const rank = (member: SessionGroupMemberDetail) => commonMemberIds.has(member.memberId) ? 0 : branchOf.has(member.memberId) ? 1 : 2;
      return rank(left) - rank(right);
    })
    : detail?.members ?? [];
  const blockedTargets = props.unifyPlan?.targets.flatMap((target) => {
    const preview = target.preview;
    const issue = target.error || !preview ? target.error ?? "无法检查内容"
      : preview.client !== props.unifyPlan?.client || preview.groupId !== props.unifyPlan.groupId
        || preview.sourceMemberId !== props.unifyPlan.sourceMemberId || preview.targetMemberId !== target.memberId
        ? "检查结果与当前会话不匹配，请重新选择副本"
        : preview.verdict !== "identical" && (!preview.previewToken || !preview.availableModes.some((mode) => ["fastForward", "overwrite", "unifyOverwrite"].includes(mode)))
          ? preview.reason || "无法安全更新此副本"
          : null;
    return issue ? [{ ...target, issue }] : [];
  }) ?? [];
  const changedTargets = props.unifyPlan?.targets.filter((target) => target.preview?.verdict !== "identical") ?? [];
  const overwrittenTargets = props.unifyPlan?.targets.filter((target) => target.preview?.availableModes.some((mode) => mode === "overwrite" || mode === "unifyOverwrite")) ?? [];
  const runningVariants = props.currentAccounts.flatMap((current) => current.running && current.variant ? [current.variant] : []);
  const restartVariants = runningVariants.filter((variant) => props.unifyPlan?.targets.some((target) => {
    if (target.preview?.verdict === "identical") return false;
    const member = detail?.members.find((item) => item.memberId === target.memberId);
    const current = props.currentAccounts.find((item) => item.variant === variant);
    return member?.variant === variant && (!current?.uid || current.uid === member.uid || current.uid === member.accountId);
  }));
  /** 插件侧：VS Code 是否正在运行（详情加载时的状态；执行前后端会再次核对实际状态）。 */
  const editorRunning = props.client === "vscodeExt" && props.currentAccounts.some((current) => current.running === true);
  /** 统一确认框的运行提示：WorkBuddy 按档位、插件按编辑器分别措辞；其他客户端不显示。 */
  const restartNotice = props.client === "workbuddy"
    ? {
        title: runningVariants.length ? `当前运行：${runningVariants.map(variantLabel).join("、")}` : "执行前会检查客户端运行状态",
        description: `${restartVariants.length ? `确认后将先关闭目标账号所在的${restartVariants.map(variantLabel).join("、")}，同步结束再自动打开。` : "若目标账号所在的客户端正在运行，确认后将自动关闭并在同步结束后重新打开。"}请先保存未完成的输入；执行时会再次核对实际运行状态。若写入待恢复，将暂停重新打开并提示处理。`,
        willRestart: restartVariants.length > 0,
      }
    : props.client === "vscodeExt"
      ? {
          title: editorRunning ? "当前运行：VS Code" : "执行前会检查 VS Code 运行状态",
          description: `${editorRunning ? "若写入目标包含当前登录账号，确认后将先关闭 VS Code，同步结束再自动打开。" : "若写入目标包含当前登录账号且 VS Code 正在运行，确认后将自动关闭并在同步结束后重新打开。"}请先保存未完成的输入；执行时会再次核对实际运行状态。`,
          willRestart: editorRunning,
        }
      : null;
  const summary = equal
    ? `${active.length} 个账号内容一致`
    : canBatch ? `有 ${behind.length} 个账号待同步`
    : conflict && divergence ? `${divergence.commonMemberIds.length} 个账号在共同旧版，另有 ${divergence.branches.length} 条独立更新`
    : conflict ? `${active.length} 个账号的会话内容不一致`
    : detail?.summaryStatus === "missing" ? "部分账号内容缺失" : "部分内容状态尚无法确认";
  // Close the popover after the page handler settled; it resolves on failure too and keeps the toast.
  async function completeAdd() {
    await props.onAdd();
    props.setAddOpen(false);
  }
  function openAdd() {
    props.setAddOpen(true);
  }
  // 确认框成员来自当前 detail。成功后父层刷新会让成员消失；失败时父层 toast 并 reject，框留着可重试。
  async function completeUnlink() {
    if (!unlinkTarget || unlinkBusy) return;
    setUnlinkBusy(true);
    try {
      await props.onUnlinkMember(unlinkTarget);
      setUnlinkTargetId(null);
    } catch {
      // 父层已 toast。
    } finally {
      setUnlinkBusy(false);
    }
  }
  function sourceSelect(label: string) {
    return <Select value={selectedSource?.memberId ?? ""} onValueChange={props.setSourceMemberId} disabled={props.busy || sourceOptions.length === 0}>
      <SelectTrigger size="sm" className="w-full min-w-0 bg-background text-xs" aria-label={label}><SelectValue placeholder="选择可读取的账号副本" /></SelectTrigger>
      <SelectContent>{sourceOptions.map((member) => <SelectItem key={member.memberId} value={member.memberId} className="text-xs">{member.accountName} · {variantLabel(member.variant)}</SelectItem>)}</SelectContent>
    </Select>;
  }

  return <section aria-label="会话组详情" className="session-relationship flex h-full min-h-0 min-w-0 flex-col bg-card">
    <div className="flex shrink-0 items-center justify-between px-4 py-2.5">
      <span className="text-xs font-medium text-muted-foreground">会话详情</span>
      <Button variant="ghost" size={props.fullPage ? "sm" : "icon"} className={props.fullPage ? "h-7 text-xs" : "size-7"} aria-label={props.fullPage ? "返回会话" : "关闭详情"} onClick={props.onClose}>
        {props.fullPage ? <><ChevronLeft className="size-3.5" />返回会话</> : <X className="size-4" />}
      </Button>
    </div>
    <div data-detail-scroll className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
      {props.error && <div role="alert" className="mb-3 space-y-1.5 rounded-lg border border-destructive/30 p-2.5 text-xs text-destructive">
        <p className="break-words">{props.error}</p><Button variant="outline" size="sm" className="h-7 text-xs" disabled={props.loading} onClick={props.onRetry}>重试</Button>
      </div>}
      {!detail && !props.error && <div aria-label="正在加载会话详情" aria-busy="true" className="space-y-3">
        <Skeleton className="h-6 w-3/4" /><Skeleton className="h-5 w-28" /><Skeleton className="h-12 w-full" /><Skeleton className="h-5 w-32" /><Skeleton className="h-52 w-full" />
      </div>}
      {detail && <>
        <h2 className="session-detail-title break-words text-lg font-semibold leading-snug tracking-tight">{detail.title}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <Badge variant="success">{clientNames[props.client]}</Badge>
          <span className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground"><Folder className="size-3 shrink-0" /><span className="truncate" title={detail.projectLabel}>{detail.projectLabel || "未标记项目"}</span></span>
        </div>
        <Alert variant={conflict ? "destructive" : canBatch ? "warning" : equal ? "success" : "default"} className={`my-3 min-w-0 items-center py-2.5 pr-11 [&>svg]:translate-y-0 ${conflict ? "border-destructive/35 bg-destructive/10 text-destructive dark:text-red-300" : canBatch ? "dark:text-amber-200" : equal ? "" : "bg-muted/70"}`} data-relationship-summary>
          {conflict ? <TriangleAlert aria-hidden="true" /> : equal ? <Check aria-hidden="true" /> : <Info aria-hidden="true" />}
          <AlertTitle className="text-xs leading-4">{summary}</AlertTitle>
          {conflict && <AlertDescription className="text-[11px] leading-4 text-destructive/85 dark:text-red-200/80">{divergence ? "这些更新都包含共同旧版，但彼此内容不同，无法自动合并。请选择要保留的一份。" : "选择要保留的一份；确认后将它的内容统一到其他可验证的账号。"}</AlertDescription>}
          {equal && active[0]?.recordCount != null && <AlertDescription className="text-[11px] leading-4">{active[0].recordCount} 条内容 · 无需同步</AlertDescription>}
          <Button variant="ghost" size="icon" className={`absolute right-2 top-1 size-7 ${conflict ? "hover:bg-destructive/10" : canBatch ? "hover:bg-amber-500/10" : "hover:bg-emerald-500/10"}`} aria-label="重新检查会话状态" title="重新检查" disabled={props.loading || props.busy} onClick={props.onRetry}><RefreshCw className={`size-3.5 ${props.loading ? "animate-spin" : ""}`} /></Button>
        </Alert>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div><h3 className="text-sm font-semibold">{divergence ? "内容分支图" : "会话关联图"}</h3><p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{divergence ? `共同旧版上的 ${divergence.branches.length} 条独立更新` : "同一会话，在不同账号中各有一份"}</p></div>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">{detail.members.length} 个账号</span>
        </div>
        <div className="relationship-canvas rounded-xl border border-brand/10 bg-brand/5 p-3">
          {divergence && <div className="relationship-group-labels mb-2 flex items-center justify-between gap-3 text-[11px] leading-4">
            <span className="rounded-md bg-amber-500/10 px-2 py-1 font-medium text-amber-800 dark:text-amber-200">共同旧版 · {divergence.commonMemberIds.length} 个账号</span>
            <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="rounded-md bg-destructive/10 px-2 py-1 font-medium text-destructive">独立更新 · {divergence.branches.length} 条分支</span>
          </div>}
          <div ref={graphRef} className="relationship-graph" data-lineage={!!divergence}>
          <svg className="relationship-connections" aria-hidden="true">{connections.map((line, index) => <g key={index} data-line-tone={line.tone}><path d={line.path} />{line.points.map((point, pointIndex) => <circle key={pointIndex} cx={point.x} cy={point.y} r="3.5" />)}</g>)}</svg>
          <div className="relationship-root" data-session-hub>
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-brand/25 bg-brand/10 text-brand"><FileText className="size-5" /></span>
            <div><p className="text-sm font-semibold">{divergence ? "共同旧版" : "同一会话"}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{divergence ? `${divergence.commonMemberIds.length} 个账号内容相同` : `${detail.members.length} 个关联账号`}</p></div>{equal && <Badge variant="success">内容一致</Badge>}
          </div>
          <ul className="relationship-members" aria-label="关联账号副本">
            {displayMembers.map((member, index) => {
              const isActive = member.linkState === "active";
              const isCurrent = isActive && props.currentAccounts.some((current) =>
                (!current.variant || current.variant === member.variant)
                && ((current.uid && (current.uid === member.uid || current.uid === member.accountId))
                  || (current.accountId && current.accountId === member.accountId)),
              );
              const status = member.linkState === "active" ? member.versionStatus : member.linkState;
              const branchIndex = branchOf.get(member.memberId);
              const graphRole = divergence ? commonMemberIds.has(member.memberId) ? "common" : branchIndex != null ? "branch" : undefined : undefined;
              const commonCount = divergence?.commonMemberIds.length ?? Math.ceil(displayMembers.length / 2);
              return <li key={member.memberId} className="relationship-branch" style={{ gridColumn: index < commonCount ? 1 : 3, gridRow: index < commonCount ? index + 1 : index - commonCount + 1 }} data-session-member={member.memberId} data-link-state={member.linkState} data-graph-role={graphRole} data-branch-index={branchIndex}>
                  <article className={`relative min-w-0 rounded-lg border bg-card p-2.5 shadow-xs ${isActive ? "border-border" : "border-dashed border-border text-muted-foreground"}`}>
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <h4 className="min-w-0 break-words text-sm font-semibold [overflow-wrap:anywhere]">{member.accountName}</h4>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <MemberVariantMark client={props.client} variant={member.variant} isCurrent={isCurrent} />
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-6 text-muted-foreground hover:text-foreground" aria-label={`${member.accountName} 的操作`} title="更多操作"><Ellipsis className="size-3.5" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-36">
                            <DropdownMenuItem onSelect={() => setUnlinkTargetId(member.memberId)}><Unlink />取消关联</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center justify-between gap-1.5"><span className="text-xs tabular-nums text-muted-foreground">{member.recordCount == null ? "内容条数无法确认" : `${member.recordCount} 条内容`}</span>{divergence && commonMemberIds.has(member.memberId) ? <Badge variant="warning" className="text-[10px]">共同旧版</Badge> : branchIndex != null ? <Badge variant="outline" data-branch-badge className="text-[10px]">分支 {branchIndex + 1}</Badge> : (!conflict || !member.canBeSource) && <MemberStatus status={status} equal={equal} />}</div>
                    <Collapsible className="mt-0.5">
                      <div className="flex flex-wrap items-center justify-between gap-x-2"><p className="text-[11px] text-muted-foreground">{formatDate(member.updatedAt)}</p><CollapsibleTrigger asChild><Button variant="ghost" size="sm" className="h-5 gap-0.5 px-0 text-[11px] text-brand">{conflict && member.canBeSource ? "查看内容" : "副本详情"}<ChevronDown className="size-3" /></Button></CollapsibleTrigger></div>
                      <CollapsibleContent className="space-y-1.5 py-1.5 text-[11px] leading-4 text-muted-foreground">
                        {conflict && member.canBeSource && <div className="max-h-44 space-y-1.5 overflow-y-auto rounded-md bg-muted/60 p-2">
                          {member.contentPreview?.length ? <><p>最近 {member.contentPreview.length} 条可读内容：</p>{member.contentPreview.map((item, previewIndex) => <p key={previewIndex} className="break-words"><span className="font-medium text-foreground">{item.speaker}：</span>{item.text}</p>)}</> : <p>此副本暂无可展示的内容预览，请在对应客户端查看完整会话。</p>}
                        </div>}
                        <p className="break-words">{member.projectLabel || "未标记工作区"}</p><p className="break-words">{member.reason}</p>
                      </CollapsibleContent>
                    </Collapsible>
                    {isActive && member.versionStatus === "behind" && batchSource && <p className="mt-1.5 flex items-start gap-1 text-[11px] leading-4 text-muted-foreground"><ArrowRight className="mt-0.5 size-3 shrink-0" /><span className="break-words">可从「{batchSource.accountName}」同步</span></p>}
                    {conflict && member.canBeSource && <Button variant="outline" size="sm" className="mt-1.5 h-7 px-2 text-xs" disabled={props.busy || !!props.unifyLoading} onClick={() => props.onPrepareUnify(member)}>{props.unifyLoading === member.memberId ? <Loader2 className="size-3.5 animate-spin" /> : null}{commonMemberIds.has(member.memberId) ? "以旧版为准" : "以此为准"}</Button>}
                  </article>
              </li>;
            })}
          </ul>
          </div>
          {equal && <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] leading-4 text-muted-foreground"><Check className="size-3.5 shrink-0 text-brand" />有效关联内容一致，无需同步</p>}
        </div>
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-4 text-muted-foreground"><Info className="mt-0.5 size-3 shrink-0" />{divergence ? "线条表示已验证的内容继承与分叉；不同颜色的分支互有新增，无法自动合并。" : conflict ? "连线只表示这些账号属于同一会话；不会自动选择要保留的内容。" : equal ? "账号更新后，可重新检查内容状态。" : "连线表示账号关联；仅在确认可安全补齐时提供批量同步。"}</p>
      </>}
    </div>
    {detail && <Popover open={props.addOpen} onOpenChange={(open) => { if (!open) props.setAddOpen(false); }}>
      <footer data-detail-footer className="relationship-footer shrink-0 space-y-1.5 border-t border-border/70 bg-card px-4 py-2.5">
        {canBatch ? <>
          <DemoAction className="w-full"><Button size="sm" className="h-8 w-full bg-brand text-xs text-brand-foreground hover:bg-brand/90" disabled={props.busy} onClick={props.onBatchSync}><RefreshCw className={`size-3.5 ${props.busy ? "animate-spin" : ""}`} />同步到 {behind.length} 个落后账号</Button></DemoAction>
          <div className="flex items-center justify-between gap-2"><p className="min-w-0 truncate text-[11px] text-muted-foreground" title={`${batchSource.accountName} → ${behind.map((member) => member.accountName).join("、")}`}>{batchSource.accountName} → {behind.length} 个账号</p><PopoverTrigger asChild><Button variant="outline" size="sm" className="h-8 shrink-0 text-xs" disabled={detail.addTargets.length === 0} onClick={openAdd}><Plus className="size-3.5" />关联新账号</Button></PopoverTrigger></div>
        </> : conflict ? <>
          <p className="text-center text-xs text-muted-foreground">在上方选择一个副本，统一其他账号</p>
          <PopoverTrigger asChild><Button variant="outline" size="sm" className="h-8 w-full text-xs" disabled={detail.addTargets.length === 0} onClick={openAdd}><Plus className="size-3.5" />关联新账号</Button></PopoverTrigger>
        </> : <>
          <PopoverTrigger asChild><Button variant="outline" size="sm" className="h-8 w-full text-xs" disabled={detail.addTargets.length === 0} onClick={openAdd}><Link2 className="size-3.5" />关联新账号</Button></PopoverTrigger>
          <p className="text-center text-[11px] leading-4 text-muted-foreground">选择一个现有账号，将会话复制到新账号</p>
        </>}
      </footer>
      <PopoverContent side="top" collisionPadding={12} aria-label="关联新账号" className="w-[min(304px,calc(100vw-32px))] space-y-2.5 p-3">
        <h3 className="text-xs font-semibold">关联新账号</h3>
        <p className="text-[11px] leading-4 text-muted-foreground">{equal ? "选择任一可读取的副本，复制到新账号并建立关联。" : "将所选账号的当前副本复制到新账号，并建立关联。"}</p>
        <div className="space-y-1"><p className="text-[11px] font-medium">复制来源</p>{sourceSelect("选择复制来源")}</div>
        <div className="space-y-1"><p className="text-[11px] font-medium">目标账号</p><Select value={props.addTargetId} onValueChange={props.setAddTargetId} disabled={props.busy || detail.addTargets.length === 0}>
          <SelectTrigger size="sm" className="w-full min-w-0 bg-background text-xs" aria-label="目标关联账号"><SelectValue placeholder="选择兼容账号" /></SelectTrigger>
          <SelectContent>{detail.addTargets.map((account) => <SelectItem key={account.id} value={account.id} className="text-xs">{displayName(account)} · {variantLabel(accountVariant(account))}</SelectItem>)}</SelectContent>
        </Select></div>
        {detail.addTargets.length === 0 && <p className="text-[11px] text-muted-foreground">没有可添加的兼容账号。</p>}
        <DemoAction className="w-full"><Button size="sm" className="h-8 w-full text-xs" disabled={props.busy || !selectedSource || !props.addTargetId} onClick={() => void completeAdd()}><Copy className="size-3.5" />{props.busy ? "处理中…" : "复制并关联"}</Button></DemoAction>
        <PopoverArrow />
      </PopoverContent>
    </Popover>}
    <AlertDialog open={!!props.unifyPlan} onOpenChange={(open) => { if (!open) props.setUnifyPlan(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>以「{props.unifyPlan?.sourceName}」的内容为准？</AlertDialogTitle>
          <AlertDialogDescription>
            将这份会话内容统一到其他 {props.unifyPlan?.targets.length ?? 0} 个账号。内容相同的账号会跳过。
          </AlertDialogDescription>
        </AlertDialogHeader>
        {props.unifyPlan && commonMemberIds.has(props.unifyPlan.sourceMemberId) && <Alert variant="destructive" className="py-2.5">
          <TriangleAlert aria-hidden="true" />
          <AlertTitle className="text-xs leading-4">你选择的是共同旧版</AlertTitle>
          <AlertDescription className="text-[11px] leading-4">确认后，两条独立分支中的新增内容都会被旧版替换。</AlertDescription>
        </Alert>}
        {restartNotice && changedTargets.length > 0 && <Alert variant="warning" className="py-2.5 dark:text-amber-200">
          <Info aria-hidden="true" />
          <AlertTitle className="text-xs leading-4">{restartNotice.title}</AlertTitle>
          <AlertDescription className="text-[11px] leading-4 text-amber-900/80 dark:text-amber-200/80">{restartNotice.description}</AlertDescription>
        </Alert>}
        {overwrittenTargets.length > 0 && <p className="text-sm text-destructive">其中 {overwrittenTargets.length} 个账号有独有内容；确认后，它们现有的会话内容会被完整替换。</p>}
        {blockedTargets.length > 0 && <div role="alert" className="space-y-1 rounded-lg bg-muted p-3 text-sm">
          <p className="font-medium">目前无法统一全部账号</p>
          {blockedTargets.map((target) => <p key={target.memberId} className="break-words text-muted-foreground">{target.accountName}：{target.issue}</p>)}
        </div>}
        {blockedTargets.length === 0 && <p className="text-xs text-muted-foreground">将更新 {changedTargets.length} 个账号。执行前会重新校验各副本内容；若内容已变化，操作会停止并报告结果。</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={props.busy}>取消</AlertDialogCancel>
          {blockedTargets.length === 0 && <DemoAction><Button variant={overwrittenTargets.length > 0 ? "destructive" : "default"} disabled={props.busy} onClick={() => void props.onConfirmUnify()}>{props.busy ? "处理中…" : restartNotice?.willRestart ? "确认同步并重启" : "确认统一"}</Button></DemoAction>}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <AlertDialog open={!!unlinkTarget} onOpenChange={(open) => { if (!open && !unlinkBusy) setUnlinkTargetId(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>取消「{unlinkTarget?.accountName}」的关联？</AlertDialogTitle>
          <AlertDialogDescription>
            该账号不再属于这个会话组，不再参与同步；账号里的会话内容不会被删除。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={unlinkBusy}>取消</AlertDialogCancel>
          <DemoAction><Button variant="destructive" disabled={unlinkBusy || props.busy} onClick={() => void completeUnlink()}>{unlinkBusy ? "处理中…" : "确认取消关联"}</Button></DemoAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}

function MemberStatus({ status, equal }: { status: SessionGroupMemberDetail["versionStatus"]; equal: boolean }) {
  const labels: Record<typeof status, string> = {
    latest: equal ? "内容一致" : "内容最新", behind: "内容落后", diverge: "存在分歧",
    missing: "内容缺失", unknown: "无法确认", stale: "已失效", superseded: "已替代",
  };
  const variant = status === "latest" ? "success" : ["behind", "diverge", "missing"].includes(status) ? "warning" : "outline";
  return <Badge variant={variant} className="text-[10px] font-medium">{labels[status]}</Badge>;
}

/** 档位标记：与账号页 / 设置页同一套官方图标，国际版带 INTL 角标；当前账号用绿色描边区分。 */
function MemberVariantMark({ client, variant, isCurrent }: { client: SessionGroupClient; variant: SessionGroupMemberDetail["variant"]; isCurrent: boolean }) {
  const intl = variantIsIntl(variant);
  const mark = client === "workbuddy"
    ? (intl ? <WorkBuddyAiMark size={18} /> : <WorkBuddyMark size={18} />)
    : client === "codebuddyIde"
      ? (intl ? <CodeBuddyAiIdeMark size={18} /> : <CodeBuddyCnIdeMark size={18} />)
      : (intl ? <VscodeExtAiMark size={18} /> : <VscodeExtMark size={18} />);
  const label = `${clientNames[client]} · ${variantLabel(variant)}${isCurrent ? " · 当前账号" : ""}`;
  return <span className={`inline-flex shrink-0 rounded-[26%] ${isCurrent ? "ring-2 ring-brand ring-offset-1 ring-offset-card" : ""}`} title={label} aria-label={label} role="img">{mark}</span>;
}

function formatDate(timestamp: number): string {
  if (!timestamp) return "更新时间未知";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(timestamp);
}
