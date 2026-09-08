import { describe, expect, it } from "vitest";
import {
	buildPlanUsageParts,
	type PlanUsage,
	parsePlanUsage,
} from "../extensions/zentui/plan-usage";

/** Matches the payload pi-claude-bridge publishes on `usage:plan`. */
function payload(
	windows: Record<number, { percent: number; resetsAt: number }>,
	primary = 5,
): unknown {
	return { source: "claude-bridge", updatedAt: 1788746000000, primary, windows };
}

// 1788745800 is 04:50 local on the machine that captured the original event.
const resetClock = (() => {
	const d = new Date(1788745800 * 1000);
	return `${`${d.getHours()}`.padStart(2, "0")}:${`${d.getMinutes()}`.padStart(2, "0")}`;
})();

describe("plan usage parsing", () => {
	it("accepts a well-formed payload", () => {
		const usage = parsePlanUsage(payload({ 5: { percent: 37, resetsAt: 1788745800 } }));
		expect(usage?.windows[5]).toEqual({ percent: 37, resetsAt: 1788745800 });
	});

	it("rejects payloads from a publisher that does not follow the contract", () => {
		expect(parsePlanUsage(undefined)).toBeUndefined();
		expect(parsePlanUsage({ source: "x" })).toBeUndefined();
		expect(parsePlanUsage(payload({}))).toBeUndefined();
		expect(
			parsePlanUsage({ ...(payload({}) as object), windows: { 5: { percent: "37" } } }),
		).toBeUndefined();
	});
});

describe("plan usage rendering", () => {
	it("shows the 5h window as percentage, label, and reset clock", () => {
		const usage = parsePlanUsage(payload({ 5: { percent: 37, resetsAt: 1788745800 } }));
		expect(buildPlanUsageParts(usage).map((p) => p.text)).toEqual([`37%/5h ${resetClock}`]);
	});

	it("hides a non-primary window while it is below the visibility threshold", () => {
		const usage = parsePlanUsage(
			payload({
				5: { percent: 37, resetsAt: 1788745800 },
				168: { percent: 30, resetsAt: 1788958800 },
			}),
		);
		expect(buildPlanUsageParts(usage).map((p) => p.text)).toEqual([`37%/5h ${resetClock}`]);
	});

	it("adds a non-primary window, percentage only, once it passes 80", () => {
		const usage = parsePlanUsage(
			payload({
				5: { percent: 37, resetsAt: 1788745800 },
				168: { percent: 82, resetsAt: 1788958800 },
			}),
		);
		expect(buildPlanUsageParts(usage).map((p) => p.text)).toEqual([
			`37%/5h ${resetClock}`,
			"82%/7d",
		]);
	});

	// Each part carries its own percentage so the footer can colour a loud 7d
	// window differently from a quiet 5h one.
	it("reports each window's percentage for independent colouring", () => {
		const usage = parsePlanUsage(
			payload({
				5: { percent: 12, resetsAt: 1788745800 },
				168: { percent: 95, resetsAt: 1788958800 },
			}),
		);
		expect(buildPlanUsageParts(usage).map((p) => p.percent)).toEqual([12, 95]);
	});

	it("renders nothing before the first reading arrives", () => {
		expect(buildPlanUsageParts(undefined)).toEqual([]);
	});

	// zentui must not assume Claude's window sizes: whichever window a publisher
	// marks primary is the always-present one, and the rest are threshold-gated.
	it("follows the publisher's primary key rather than a fixed window", () => {
		const usage = parsePlanUsage(
			payload(
				{
					24: { percent: 10, resetsAt: 1788745800 },
					720: { percent: 91, resetsAt: 1788958800 },
				},
				24,
			),
		);
		expect(buildPlanUsageParts(usage).map((p) => p.text)).toEqual([
			`10%/1d ${resetClock}`,
			"91%/30d",
		]);
	});

	it("labels a window that is not a whole number of days in hours", () => {
		const usage = parsePlanUsage(payload({ 5: { percent: 20, resetsAt: 1788745800 } }, 5));
		expect(buildPlanUsageParts(usage)[0]?.text).toBe(`20%/5h ${resetClock}`);
	});

	it("still shows threshold-passing windows when the primary is missing", () => {
		const usage = parsePlanUsage(payload({ 168: { percent: 90, resetsAt: 1788958800 } }, 5));
		expect(buildPlanUsageParts(usage).map((p) => p.text)).toEqual(["90%/7d"]);
	});

	it("rounds percentages to whole numbers", () => {
		const usage = parsePlanUsage(payload({ 5: { percent: 37.6, resetsAt: 1788745800 } }));
		expect(buildPlanUsageParts(usage)[0]?.text).toBe(`38%/5h ${resetClock}`);
	});

	it("still renders a window whose reset time is unusable", () => {
		const usage: PlanUsage = {
			source: "s",
			updatedAt: 1,
			primary: 5,
			windows: { 5: { percent: 40, resetsAt: Number.MAX_SAFE_INTEGER } },
		};
		expect(buildPlanUsageParts(usage)[0]?.text).toBe("40%/5h");
	});
});
