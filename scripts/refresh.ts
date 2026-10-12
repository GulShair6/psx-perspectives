import { companies, saveSnapshot } from "../lib/db";
import { collectPsx } from "../lib/sources";
async function main() {
  let failures = 0;
  for (const c of companies()) {
    try {
      const s = await collectPsx(c.symbol);
      saveSnapshot(c.symbol, s);
      console.log(
        `${c.symbol}: real PSX quote ${s.price}, ${s.annual.periods.length} annual periods, ${s.payouts.length} payouts`,
      );
    } catch (e) {
      failures++;
      console.error(`${c.symbol}: ${e instanceof Error ? e.message : e}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  process.exitCode = failures ? 1 : 0;
}
main();
