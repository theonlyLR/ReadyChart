export const NEGATIVE_CASHFLOW_FIXTURE = { labels: ["Q1", "Q2", "Q3", "Q4"], values: [-14.2, -3.5, 8.9, 22.4] };
export const HIGH_DENSITY_COLLISION_FIXTURE = { labels: Array.from({ length: 36 }, (_, i) => "2024-W" + String(i + 1).padStart(2, "0")), values: Array.from({ length: 36 }, (_, i) => Math.round(40 + Math.sin(i / 3) * 25)) };
export const MICRO_SLICE_PIE_FIXTURE = { labels: ["Enterprise", "Mid-Market", "SMB", "Self-Serve", "Partner", "Legacy", "Other Trial"], values: [54.0, 26.5, 12.0, 4.2, 1.5, 1.1, 0.7] };
export const MESSY_SLACK_PASTE = "Hey team — quick Q3 regional numbers: Lagos hit ₦48,500,000 (+18%), London closed at £312.4k, and Berlin came in at 1.250,50 € after refunds.";
export const MESSY_WIKIPEDIA_TSV = "Year\tRevenue ($M)\tYoY Growth\n2022\t$142.8\t14.2%\n2023\t$198.4\t38.9%\n2024\t$271.0\t36.6%";
