import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const PLAN_USAGE_EVENT = "usage:plan";

/** Non-primary windows are only shown once they are close enough to matter. */
export const SECONDARY_VISIBLE_AT = 80;

const HOURS_PER_DAY = 24;

export type PlanUsageWindow = {
	percent: number;
	resetsAt: number;
};

export type PlanUsage = {
	source: string;
	updatedAt: number;
	primary: number;
	windows: Record<number, PlanUsageWindow>;
};

function toWindow(raw: unknown): PlanUsageWindow | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const { percent, resetsAt } = raw as { percent?: unknown; resetsAt?: unknown };
	if (typeof percent !== "number" || !Number.isFinite(percent)) return undefined;
	if (typeof resetsAt !== "number" || !Number.isFinite(resetsAt)) return undefined;
	return { percent, resetsAt };
}

/**
 * The payload crosses an extension boundary from an arbitrary publisher, so it
 * is validated rather than trusted. Anything malformed yields undefined, which
 * leaves the previous reading on screen instead of blanking it.
 */
export function parsePlanUsage(data: unknown): PlanUsage | undefined {
	if (!data || typeof data !== "object") return undefined;
	const { source, updatedAt, primary, windows } = data as Record<string, unknown>;
	if (typeof source !== "string") return undefined;
	if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt)) return undefined;
	if (typeof primary !== "number" || !Number.isFinite(primary)) return undefined;
	if (!windows || typeof windows !== "object") return undefined;

	const parsed: Record<number, PlanUsageWindow> = {};
	for (const [key, value] of Object.entries(windows as Record<string, unknown>)) {
		const hours = Number(key);
		if (!Number.isFinite(hours)) continue;
		const win = toWindow(value);
		if (win) parsed[hours] = win;
	}
	if (Object.keys(parsed).length === 0) return undefined;
	return { source, updatedAt, primary, windows: parsed };
}

function formatPercent(percent: number): string {
	return `${Math.round(Math.max(0, Math.min(100, percent)))}%`;
}

function formatResetClock(resetsAt: number): string {
	const date = new Date(resetsAt * 1000);
	if (Number.isNaN(date.getTime())) return "";
	const hours = `${date.getHours()}`.padStart(2, "0");
	const minutes = `${date.getMinutes()}`.padStart(2, "0");
	return `${hours}:${minutes}`;
}

/** Publishers key windows by length in hours; 5 reads as `5h`, 168 as `7d`. */
function formatWindowLabel(hours: number): string {
	return hours >= HOURS_PER_DAY && hours % HOURS_PER_DAY === 0
		? `${hours / HOURS_PER_DAY}d`
		: `${hours}h`;
}

export type PlanUsagePart = {
	text: string;
	percent: number;
};

export function buildPlanUsageParts(usage: PlanUsage | undefined): PlanUsagePart[] {
	if (!usage) return [];
	const parts: PlanUsagePart[] = [];

	const primary = usage.windows[usage.primary];
	if (primary) {
		const clock = formatResetClock(primary.resetsAt);
		parts.push({
			text: `${formatPercent(primary.percent)}/${formatWindowLabel(usage.primary)}${clock ? ` ${clock}` : ""}`,
			percent: primary.percent,
		});
	}

	for (const [key, window] of Object.entries(usage.windows)) {
		const hours = Number(key);
		if (hours === usage.primary || window.percent <= SECONDARY_VISIBLE_AT) continue;
		parts.push({
			text: `${formatPercent(window.percent)}/${formatWindowLabel(hours)}`,
			percent: window.percent,
		});
	}

	return parts;
}

export function subscribePlanUsage(
	events: ExtensionAPI["events"] | undefined,
	onUpdate: (usage: PlanUsage) => void,
): () => void {
	if (typeof events?.on !== "function") return () => {};
	try {
		return events.on(PLAN_USAGE_EVENT, (data) => {
			const usage = parsePlanUsage(data);
			if (usage) onUpdate(usage);
		});
	} catch {
		return () => {};
	}
}
