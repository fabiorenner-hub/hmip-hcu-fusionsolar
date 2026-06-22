"use strict";

// Minimal multi-series line/area chart on a 2D canvas. No deps.
// Honours the device pixel ratio, axis labels in time + value units.

(function () {
	const PALETTE = ["#4fbfa8", "#f59e0b", "#60a5fa", "#ef4444", "#a78bfa", "#34d399"];

	class TimeChart {
		constructor(canvas, opts = {}) {
			this.canvas = canvas;
			this.ctx = canvas.getContext("2d");
			this.opts = {
				yLabel: opts.yLabel || "",
				yFormat: opts.yFormat || ((v) => v.toFixed(0)),
				xPadding: 8,
				yPadding: 8,
				gridColor: getCss("--border"),
				textColor: getCss("--muted"),
				zeroLine: opts.zeroLine || false,
				series: [], // populated by setSeries
				min: opts.min ?? null,
				max: opts.max ?? null,
			};
			this._resize();
			window.addEventListener("resize", () => this._resize());
			this._hoverX = null;
			canvas.addEventListener("mousemove", (e) => {
				const rect = canvas.getBoundingClientRect();
				this._hoverX = e.clientX - rect.left;
				this._draw();
			});
			canvas.addEventListener("mouseleave", () => {
				this._hoverX = null;
				this._draw();
			});
		}

		_resize() {
			const dpr = window.devicePixelRatio || 1;
			const rect = this.canvas.getBoundingClientRect();
			this.canvas.width = rect.width * dpr;
			this.canvas.height = rect.height * dpr;
			this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			this._draw();
		}

		setSeries(series) {
			this.opts.series = series.map((s, i) => ({
				color: s.color || PALETTE[i % PALETTE.length],
				area: !!s.area,
				...s,
			}));
			this._draw();
		}

		setData(samples, opts = {}) {
			this.samples = samples || [];
			if (opts.min !== undefined) this.opts.min = opts.min;
			if (opts.max !== undefined) this.opts.max = opts.max;
			this._draw();
		}

		_draw() {
			const { ctx, opts } = this;
			const w = this.canvas.clientWidth;
			const h = this.canvas.clientHeight;
			ctx.clearRect(0, 0, w, h);
			if (!this.samples || !this.samples.length || !opts.series.length) return;

			const padL = 48;
			const padR = 12;
			const padT = 14;
			const padB = 22;
			const plotW = w - padL - padR;
			const plotH = h - padT - padB;

			const tMin = this.samples[0].t;
			const tMax = this.samples[this.samples.length - 1].t;
			const tSpan = Math.max(1, tMax - tMin);

			// Y range
			let yMin = opts.min;
			let yMax = opts.max;
			if (yMin === null || yMax === null) {
				let mn = Infinity, mx = -Infinity;
				for (const s of this.samples) {
					for (const sr of opts.series) {
						const v = s[sr.key];
						if (typeof v === "number" && !Number.isNaN(v)) {
							if (v < mn) mn = v;
							if (v > mx) mx = v;
						}
					}
				}
				if (mn === Infinity) { mn = 0; mx = 1; }
				if (mn === mx) { mn -= 1; mx += 1; }
				yMin = opts.min ?? mn;
				yMax = opts.max ?? mx;
				const pad = (yMax - yMin) * 0.08;
				yMin -= pad;
				yMax += pad;
			}
			const ySpan = Math.max(1e-6, yMax - yMin);

			const xAt = (t) => padL + ((t - tMin) / tSpan) * plotW;
			const yAt = (v) => padT + plotH - ((v - yMin) / ySpan) * plotH;

			// Grid + axis
			ctx.strokeStyle = opts.gridColor;
			ctx.fillStyle = opts.textColor;
			ctx.lineWidth = 1;
			ctx.font = "11px ui-monospace, monospace";
			ctx.textBaseline = "middle";

			const yTicks = 4;
			for (let i = 0; i <= yTicks; i += 1) {
				const v = yMin + ((yMax - yMin) * i) / yTicks;
				const y = yAt(v);
				ctx.globalAlpha = 0.4;
				ctx.beginPath();
				ctx.moveTo(padL, y);
				ctx.lineTo(w - padR, y);
				ctx.stroke();
				ctx.globalAlpha = 1;
				ctx.fillText(opts.yFormat(v), 6, y);
			}

			if (opts.zeroLine && yMin < 0 && yMax > 0) {
				const y0 = yAt(0);
				ctx.globalAlpha = 0.7;
				ctx.strokeStyle = opts.gridColor;
				ctx.lineWidth = 1.5;
				ctx.beginPath();
				ctx.moveTo(padL, y0);
				ctx.lineTo(w - padR, y0);
				ctx.stroke();
				ctx.globalAlpha = 1;
				ctx.lineWidth = 1;
			}

			// X labels (3 ticks)
			ctx.textAlign = "center";
			for (let i = 0; i <= 3; i += 1) {
				const t = tMin + (tSpan * i) / 3;
				const x = xAt(t);
				ctx.fillText(formatTime(t), x, h - 8);
			}
			ctx.textAlign = "start";

			// Series
			for (const sr of opts.series) {
				ctx.strokeStyle = sr.color;
				ctx.lineWidth = 1.6;
				ctx.beginPath();
				let started = false;
				for (const s of this.samples) {
					const v = s[sr.key];
					if (typeof v !== "number" || Number.isNaN(v)) {
						started = false;
						continue;
					}
					const x = xAt(s.t);
					const y = yAt(v);
					if (!started) { ctx.moveTo(x, y); started = true; }
					else ctx.lineTo(x, y);
				}
				ctx.stroke();

				if (sr.area) {
					ctx.globalAlpha = 0.18;
					ctx.fillStyle = sr.color;
					ctx.lineTo(xAt(this.samples[this.samples.length - 1].t), yAt(yMin));
					ctx.lineTo(xAt(this.samples[0].t), yAt(yMin));
					ctx.closePath();
					ctx.fill();
					ctx.globalAlpha = 1;
				}
			}

			// Hover crosshair + value tooltip
			if (this._hoverX != null && this._hoverX >= padL && this._hoverX <= w - padR) {
				const tHover = tMin + ((this._hoverX - padL) / plotW) * tSpan;
				let near = this.samples[0];
				let best = Infinity;
				for (const s of this.samples) {
					const d = Math.abs(s.t - tHover);
					if (d < best) { best = d; near = s; }
				}
				const x = xAt(near.t);
				ctx.strokeStyle = opts.textColor;
				ctx.globalAlpha = 0.5;
				ctx.beginPath();
				ctx.moveTo(x, padT);
				ctx.lineTo(x, padT + plotH);
				ctx.stroke();
				ctx.globalAlpha = 1;

				const labels = [];
				for (const sr of opts.series) {
					const val = near[sr.key];
					if (typeof val !== "number" || Number.isNaN(val)) continue;
					const y = yAt(val);
					ctx.fillStyle = sr.color;
					ctx.beginPath();
					ctx.arc(x, y, 3, 0, Math.PI * 2);
					ctx.fill();
					labels.push({ color: sr.color, text: `${sr.label}: ${opts.yFormat(val)}` });
				}

				ctx.font = "11px ui-monospace, monospace";
				const lines = [formatTime(near.t)].concat(labels.map((l) => l.text));
				const bw = Math.max.apply(null, lines.map((l) => ctx.measureText(l).width)) + 16;
				const bh = lines.length * 14 + 8;
				let bx = x + 10;
				if (bx + bw > w - padR) bx = x - bw - 10;
				if (bx < padL) bx = padL;
				const by = padT + 4;
				ctx.globalAlpha = 0.96;
				ctx.fillStyle = getCss("--panel");
				ctx.strokeStyle = getCss("--border-strong");
				roundRect(ctx, bx, by, bw, bh, 6);
				ctx.fill();
				ctx.stroke();
				ctx.globalAlpha = 1;
				ctx.textAlign = "start";
				ctx.textBaseline = "top";
				ctx.fillStyle = opts.textColor;
				ctx.fillText(lines[0], bx + 8, by + 6);
				for (let i = 0; i < labels.length; i += 1) {
					ctx.fillStyle = labels[i].color;
					ctx.fillText(labels[i].text, bx + 8, by + 6 + (i + 1) * 14);
				}
				ctx.textBaseline = "middle";
				ctx.textAlign = "start";
			}
		}
	}

	function roundRect(ctx, x, y, w, h, r) {
		ctx.beginPath();
		ctx.moveTo(x + r, y);
		ctx.arcTo(x + w, y, x + w, y + h, r);
		ctx.arcTo(x + w, y + h, x, y + h, r);
		ctx.arcTo(x, y + h, x, y, r);
		ctx.arcTo(x, y, x + w, y, r);
		ctx.closePath();
	}

	function formatTime(ms) {
		const d = new Date(ms);
		return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
	}
	function getCss(varName) {
		return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || "#888";
	}

	window.TimeChart = TimeChart;
})();
